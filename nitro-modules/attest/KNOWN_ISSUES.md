# attest (passport-zk ZK lane) — known issues

## libc++ ABI namespace mismatch — Aztec prebuilt vs NDK r25+

### Symptom

On Android, `nitro.zk.generateNoirProof(...)` (or any UniFFI call that
triggers JNA's lazy load of `libpassport_zk_mopro.so`) throws:

```
UnsatisfiedLinkError: dlopen failed: cannot locate symbol
  "_ZTTNSt3__119basic_ostringstreamIcNS_11char_traitsIcEENS_9allocatorIcEEEE"
  referenced by libpassport_zk_mopro.so
```

(`_ZTT…basic_ostringstream…` demangles to "VTT for
`std::__1::basic_ostringstream<char>`".)

The user-facing toast is:

> ZK prover can't load on this device — using SD-JWT fallback.

…and the proof step continues via the SD-JWT fallback path (white trust,
`proofType: 'sd-jwt-fallback'`).

### Root cause

This is **NOT** what the symbol name suggests on the surface (a single
missing VTT). The real problem is much deeper.

1. `barretenberg-rs` (pulled in by `noir_rs`) does **not** compile
   barretenberg from source. Its `build.rs` **downloads a prebuilt
   static archive** `libbb-external.a` from AztecProtocol's GitHub
   releases:

   ```rust
   // ~/.cargo/registry/src/.../barretenberg-rs-4.2.0-aztecnr-rc.2/build.rs
   // …
   println!("cargo:rustc-link-lib=static=bb-external");
   // download_lib(&out_dir);  // pulled from github.com/AztecProtocol/aztec-packages releases
   ```

2. AztecProtocol's prebuilt `libbb-external.a` was compiled against an
   **upstream LLVM libc++** that uses the `__1` inline namespace
   (`std::__1::basic_ostringstream<…>`).

3. The active Android NDK r27 ships its own fork of libc++ that uses
   the `__ndk1` inline namespace
   (`std::__ndk1::basic_ostringstream<…>`). This is hardcoded in
   `<__config_site>` and not overridable via `-D_LIBCPP_ABI_NAMESPACE`
   on the command line.

4. The `.a` therefore has **3,978 undefined `_Z…NSt3__1…` symbols**
   (counted with `llvm-nm | grep ' U _Z.*St3__1' | wc -l`) and **zero**
   `_Z…NSt6__ndk1…` references. The dynamic linker has nowhere to
   resolve them — `libc++_shared.so` from NDK r27 only exports
   `__ndk1`, not `__1`.

5. dlopen aborts on the **first** missing symbol (in our case the
   `basic_ostringstream` VTT, because that's what shows up earliest in
   the relocation table). Even if that one were fixed, the next 3,977
   references would still fail.

### What we tried

| Attempt | Why it didn't work |
|---|---|
| `cargo:rustc-link-arg-cdylib=-static-libstdc++` (build.rs) | NDK clang's `-static-libstdc++` swaps `-lstdc++` (which Android doesn't use), not `-lc++_shared`. Output `.so` still listed `libc++_shared.so` as `NEEDED`. |
| `CXXSTDLIB=c++_static cargo ndk build …` | cc-rs reads `CXXSTDLIB` but mopro_ffi explicitly passes `--link-libcxx-shared` to cargo-ndk, which re-adds `-lc++_shared` after cc-rs's choice. (Moot anyway: the `.a` is prebuilt, not compiled by cc-rs.) |
| `CFLAGS_<target>="-fvisibility=default"` + `CXXFLAGS_<target>="-fvisibility=default"` | Env vars reach cargo-ndk subprocess but the `.a` is downloaded prebuilt and never recompiled, so cc-rs visibility flags are irrelevant. |
| `cargo:rustc-link-arg-cdylib=-Wl,--export-dynamic` | Only re-exports symbols already in the cdylib's static symbol table; doesn't fix references to symbols missing from `libc++_shared.so`. |
| `libcxx_stream_shim.so` with `.set` asm aliases mapping `_ZT[VTI]NSt3__1…` → `_ZT[VTI]NSt6__ndk1…` (see `android/src/main/cpp/cxx_stream_shim.cpp`) | Works perfectly for the 16/18 RTTI/VTT symbols we covered — `llvm-nm` confirms the shim exports the `__1`-namespaced names mopro expects, aliased to byte-identical `__ndk1` data. **But mopro needs 3,978 symbols, not 18.** Aliasing every member function, free function, allocator, locale, regex, filesystem, and thread symbol is not maintainable, and many can't be aliased anyway (the `__ndk1` target has to be defined in the same TU as the alias). |
| `-D_LIBCPP_ABI_NAMESPACE=__1 -D_LIBCPP_ABI_VERSION=1` on the shim TU | NDK's `<__config_site>` hardcodes `#define _LIBCPP_ABI_NAMESPACE __ndk1` and overrides the command-line `-D` after preprocessing. The shim's instantiations still came out `__ndk1`-mangled. |

### Realistic options

1. **Rebuild `libbb-external.a` from source against the active NDK.**
   AztecProtocol publishes the build script: `cd barretenberg/cpp && ./bootstrap.sh`.
   Then point `barretenberg-rs` at the local build via
   `BB_LIB_DIR=/path/to/built/lib cargo run --bin android --release` from
   `passport-noir/mopro-binding`. Multi-hour C++ build + maintenance
   burden every time barretenberg's master moves.

2. **Pin the NDK that AztecProtocol uses.** Their CI presumably runs
   on a specific NDK that still uses `__1` namespace. Match it on our
   side (Android Studio → SDK Manager → install older NDK; set
   `android.ndkVersion` in `gradle.properties`). Risk: older NDK may
   conflict with React Native / Expo's minimum-NDK requirements.

3. **Bundle a `__1`-namespaced `libc++_shared.so` sidecar.** AztecProtocol
   must link `libbb-external.a` against *some* libc++ at their final
   output stage. If we can identify and download the exact libc++
   shared object they expect (LLVM upstream prebuilts for
   `aarch64-linux-android`), ship it alongside our app as e.g.
   `libc++_shared_upstream.so`, and preload it before JNA opens the
   mopro `.so`, the dynamic linker would resolve all 3,978 references
   from there. Requires careful namespacing to avoid clashing with the
   NDK's own libc++.

4. **Stay on the SD-JWT fallback path** in production until (1), (2),
   or (3) lands. This is what `apps/expo/app/passport/index.tsx` does
   today via `ZK_UNAVAILABLE_RE` — the user sees a friendly toast and
   reaches the persist step with `trustLevel: 'white'` /
   `proofType: 'sd-jwt-fallback'` so downstream verifiers can refuse to
   count it as a real ZK attestation (CLAUDE.md rule 8).

### Verifying the ABI mismatch

```sh
NDK=~/Library/Android/sdk/ndk/27.1.12297006/toolchains/llvm/prebuilt/darwin-x86_64/bin
NM=$NDK/llvm-nm
AR=$NDK/llvm-ar
BB=$(find ~/Workspace/Work/solidarity/passport-noir/mopro-binding \
       -name 'libbb-external.a' \
       -path '*aarch64-linux-android*' | head -1)

# Count __1-namespaced undefined symbols in Aztec's prebuilt:
"$NM" "$BB" 2>/dev/null | grep -cE ' U _Z.*St3__1'    # → 3978

# Count __ndk1 references (NDK's native namespace):
"$NM" "$BB" 2>/dev/null | grep -cE ' U _Z.*St6__ndk1' # → 0

# What NDK r27's libc++_shared.so actually exports:
"$NM" -D --defined-only \
  ~/Library/Android/sdk/ndk/27.1.12297006/toolchains/llvm/prebuilt/darwin-x86_64/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so \
  | grep -cE ' _Z.*St6__ndk1'                          # → thousands of __ndk1 symbols
```

### Until fixed

`app/passport/index.tsx` catches the `UnsatisfiedLinkError` via the
`ZK_UNAVAILABLE_RE` pattern and falls through to the SD-JWT fallback
path. The user sees a friendly info toast and reaches the persist step;
the resulting credential is tagged `trustLevel: 'white'` /
`proofType: 'sd-jwt-fallback'` so downstream verifiers can refuse to
count it as a real ZK attestation (CLAUDE.md rule 8).

### Artifacts left behind from the shim experiment

The following files are kept in-tree as a reference for option (3)
above. They build cleanly and prove the aliasing technique works at the
RTTI/VTT layer; they're not loaded at runtime because they don't unblock
the 3,978-symbol bulk of the problem.

- `android/src/main/cpp/cxx_stream_shim.cpp` — explicit instantiations
  of `basic_ostringstream`, `basic_istringstream`, `basic_stringstream`,
  `basic_ofstream`, `basic_ifstream`, `basic_fstream`, `basic_ostream`,
  `basic_istream`, `basic_streambuf`, `basic_stringbuf` + asm aliases
  for the 16 `_ZT[VTI]NSt3__1…` symbols that we successfully mapped.
- `android/CMakeLists.txt` — `cxx_stream_shim` shared library target
  with `-fvisibility=default -fvisibility-inlines-hidden -O0 -fno-lto`.
- `android/src/main/java/.../HybridPassportZk.kt` — the companion
  `init {}` block that would `System.loadLibrary("cxx_stream_shim")`
  was removed; only a comment remains pointing at this file.
