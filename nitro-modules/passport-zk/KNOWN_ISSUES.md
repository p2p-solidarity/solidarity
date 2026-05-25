# passport-zk — known issues

## NDK r25+ libc++ ABI clash with barretenberg

### Symptom

On Android, `nitro.zk.generateNoirProof(...)` throws at the very first call
with an `UnsatisfiedLinkError`:

```
dlopen failed: cannot locate symbol
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

Two layers compound:

1. **NDK r25+ tightened libc++'s ABI surface.** Stream template
   instantiations (`basic_ostringstream`, `basic_ofstream`, …) are now
   annotated with `_LIBCPP_HIDE_FROM_ABI`, so `libc++_shared.so` no
   longer exports their VTT / vtable symbols. References inside user
   code are supposed to be resolved locally (each .so emits its own
   VTT).

2. **mopro_ffi → cargo-ndk → cc-rs** invokes the NDK clang with the
   default `-fvisibility=hidden` for C++ template instantiations. The VTT
   that barretenberg's headers generate ends up with hidden visibility
   in the `.o`, the linker doesn't add it to the cdylib's dynamic
   symbol table, and at `dlopen` time there's nowhere for the loader
   to find it — neither in `libc++_shared.so` (NDK hid it) nor in our
   own `libpassport_zk_mopro.so` (cc-rs didn't export it).

### What we tried

| Attempt | Why it didn't work |
|---|---|
| `cargo:rustc-link-arg-cdylib=-static-libstdc++` (build.rs) | NDK clang's `-static-libstdc++` swaps `-lstdc++` (which Android doesn't use), not `-lc++_shared`. Output `.so` still listed `libc++_shared.so` as `NEEDED`. |
| `CXXSTDLIB=c++_static cargo ndk build …` | cc-rs reads `CXXSTDLIB` but mopro_ffi explicitly passes `--link-libcxx-shared` to cargo-ndk, which re-adds `-lc++_shared` after cc-rs's choice. |
| `CFLAGS_<target>="-fvisibility=default"` + `CXXFLAGS_<target>="-fvisibility=default"` | Env vars reach cargo-ndk subprocess but barretenberg's `cc::Build::new()` calls don't reread them after the initial cache fill; full `rm -rf target build` rebuild didn't change `.so` byte size. |
| `cargo:rustc-link-arg-cdylib=-Wl,--export-dynamic` | Only re-exports symbols that already made it into the cdylib's static symbol table; if the VTT was hidden at .o link time, it's not there to re-export. |

### Realistic options

1. **Fix upstream barretenberg-rs** to compile with
   `-fvisibility=default` for its C++ stream-using sources. This is
   probably a 3-line change in
   [barretenberg-rs](https://github.com/AztecProtocol/barretenberg) or
   `noir_rs` cc-build scripts.
2. **Wait for a noir_rs release** that bundles a barretenberg with the
   fix. Track upstream issues.
3. **Patch noir_rs locally** by vendoring barretenberg + adding a custom
   `cc::Build::new().flag("-fvisibility=default")` for the stream-using
   .cpp files. ~1 day of focused work + maintenance burden.
4. **Stay on the SD-JWT fallback path** in production until (1) or (2)
   land. This is what `apps/expo/app/passport/index.tsx` does today via
   `ZK_UNAVAILABLE_RE`.

### Verifying the .so

```sh
# Does the cdylib export the missing VTT?
~/Library/Android/sdk/ndk/27.1.12297006/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-nm \
  -D --defined-only \
  nitro-modules/passport-zk/android/src/main/jniLibs/arm64-v8a/libpassport_zk_mopro.so \
  | grep _ZTTNSt3__119basic_ostringstream
# (currently empty — the dlopen failure tells the same story)

# Does the NDK's libc++_shared.so export it?
~/Library/Android/sdk/ndk/27.1.12297006/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-nm \
  -D --defined-only \
  ~/Library/Android/sdk/ndk/27.1.12297006/toolchains/llvm/prebuilt/darwin-x86_64/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so \
  | grep _ZTTNSt3__119basic_ostringstream
# (also empty — NDK r25+ hides this)
```

### Until fixed

`app/passport/index.tsx` catches the `UnsatisfiedLinkError` via the
`ZK_UNAVAILABLE_RE` pattern and falls through to the SD-JWT fallback
path. The user sees a friendly info toast and reaches the persist step;
the resulting credential is tagged `trustLevel: 'white'` /
`proofType: 'sd-jwt-fallback'` so downstream verifiers can refuse to
count it as a real ZK attestation (CLAUDE.md rule 8).
