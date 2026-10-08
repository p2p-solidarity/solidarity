// cxx_stream_shim.cpp
// @solidarity/nitro-passport-zk (Android)
//
// Workaround for the inline-namespace mismatch that breaks
// libpassport_zk_mopro.so dlopen with errors like:
//
//   UnsatisfiedLinkError: dlopen failed: cannot locate symbol
//     "_ZTTNSt3__119basic_ostringstreamIcNS_11char_traitsIcEENS_9allocatorIcEEEE"
//     referenced by libpassport_zk_mopro.so
//
// (Demangles to "VTT for `std::__1::basic_ostringstream<char>`".)
//
// ─── Root cause ────────────────────────────────────────────────────
//
// `barretenberg-rs` (pulled in by `noir_rs` via cc-rs) was compiled
// against an upstream libc++ that uses the `__1` inline namespace.
// The active Android NDK r27's libc++ uses its own fork — namespace
// `__ndk1` (set by `__config_site`'s hardcoded
// `#define _LIBCPP_ABI_NAMESPACE __ndk1`, not overridable via
// command-line `-D…`).
//
// Concretely:
//
//   - `libc++_shared.so` (NDK r27) exports `_ZT[VT]NSt6__ndk1…` symbols.
//   - `libpassport_zk_mopro.so` (barretenberg cdylib) references
//     `_ZT[VT]NSt3__1…` symbols.
//
// Different mangled names → different types from the linker's POV →
// dlopen fails before any of our code runs.
//
// ─── Fix ───────────────────────────────────────────────────────────
//
//   1. Explicitly instantiate the stream / function / regex / shared-
//      ptr-control templates that barretenberg references. The NDK
//      compiler emits these into our shim's .o under their NATIVE
//      mangled names (`St6__ndk1…`).
//
//   2. At file scope, declare GAS symbol aliases mapping the
//      `St3__1…`-mangled names mopro expects to the SAME addresses as
//      the `St6__ndk1…`-mangled symbols we just instantiated. The
//      vtable / VTT / typeinfo memory layouts are byte-identical
//      between the two namespaces — only the symbol names differ —
//      so a `.set` alias is correct, not a reinterpretation.
//
//   3. Compile with `-fvisibility=default` so the produced symbols
//      land in the dynamic symbol table; preload this .so from
//      `HybridPassportZk` companion init so the aliases exist in the
//      app's linker namespace before JNA opens the mopro cdylib.
//
// ─── Caveats ───────────────────────────────────────────────────────
//
//   - `typeid(x).name()` on a mopro-side `basic_ostringstream` will
//     say `…__ndk1…` (the underlying type-info string). Code that
//     parses type names will see drift. Barretenberg doesn't (we've
//     audited).
//   - `dynamic_cast` between a mopro-side stream pointer and a
//     shim-side one would compare type-info pointer equality and
//     succeed (alias → same address). Don't rely on this from our
//     code — keep stream usage internal to barretenberg.
//   - When `barretenberg-rs` upstream lands a fix (recompile with
//     current NDK headers, or pin `-D_LIBCPP_ABI_NAMESPACE=__ndk1`),
//     this shim becomes a no-op and can be deleted.
#include <fstream>
#include <functional>
#include <ios>
#include <memory>
#include <regex>
#include <sstream>

// ─── 1. Explicit template instantiations under __ndk1 ───────────────
template class std::basic_ostringstream<char>;
template class std::basic_istringstream<char>;
template class std::basic_stringstream<char>;
template class std::basic_ofstream<char>;
template class std::basic_ifstream<char>;
template class std::basic_fstream<char>;
template class std::basic_ostream<char>;
template class std::basic_istream<char>;
template class std::basic_streambuf<char>;
template class std::basic_stringbuf<char>;

namespace {
// Loader-time constructor: touches each instantiation so -O2 / LTO
// dead-code elimination can't drop the vtables before the linker
// emits them. Runs once at .so map time.
__attribute__((constructor)) void cxx_stream_shim_ctor() {
  static std::ostringstream s_oss;
  static std::istringstream s_iss;
  static std::stringstream s_ss;
  static std::ofstream s_ofs;
  static std::ifstream s_ifs;
  static std::fstream s_fs;
  static std::stringbuf s_sb;
  (void)s_oss.tellp();
  (void)s_iss.tellg();
  (void)s_ss.tellp();
  (void)s_ofs.is_open();
  (void)s_ifs.is_open();
  (void)s_fs.is_open();
  (void)s_sb.in_avail();
  // Touch RTTI for non-stream classes mopro pulls in (bad_function_call
  // via <functional>, regex_error via <regex>). Throwing + catching
  // forces the typeinfo symbol to be emitted.
  try {
    throw std::bad_function_call();
  } catch (const std::bad_function_call&) {
  }
  try {
    throw std::regex_error(std::regex_constants::error_collate);
  } catch (const std::regex_error&) {
  }
  // __shared_weak_count gets pulled in via shared_ptr's control block.
  auto sp = std::make_shared<int>(0);
  (void)sp.use_count();
}
}  // namespace

// ─── 2. Symbol aliases: __1-mangled → __ndk1-mangled ────────────────
//
// `.globl` exposes the alias to the dynamic symbol table.
// `.set` makes both names resolve to the same address — no extra
// memory, no copy. The aliased data is byte-identical (same class
// layout, same vtable contents), so the alias is semantically valid.
//
// `__hidden__` first so we declare the alias bind weak default-visible
// (`.weak` + `.protected` would also work, but `.globl` + `.set` is
// the most portable across NDK clang versions).

#define ALIAS(src_sym, dst_sym) \
  __asm__(".globl " #dst_sym "\n" \
          ".set " #dst_sym ", " #src_sym "\n")

extern "C" {

// VTT (virtual-table-table) aliases.
ALIAS(_ZTTNSt6__ndk114basic_ifstreamIcNS_11char_traitsIcEEEE,
      _ZTTNSt3__114basic_ifstreamIcNS_11char_traitsIcEEEE);
ALIAS(_ZTTNSt6__ndk114basic_ofstreamIcNS_11char_traitsIcEEEE,
      _ZTTNSt3__114basic_ofstreamIcNS_11char_traitsIcEEEE);
ALIAS(_ZTTNSt6__ndk118basic_stringstreamIcNS_11char_traitsIcEENS_9allocatorIcEEEE,
      _ZTTNSt3__118basic_stringstreamIcNS_11char_traitsIcEENS_9allocatorIcEEEE);
ALIAS(_ZTTNSt6__ndk119basic_istringstreamIcNS_11char_traitsIcEENS_9allocatorIcEEEE,
      _ZTTNSt3__119basic_istringstreamIcNS_11char_traitsIcEENS_9allocatorIcEEEE);
ALIAS(_ZTTNSt6__ndk119basic_ostringstreamIcNS_11char_traitsIcEENS_9allocatorIcEEEE,
      _ZTTNSt3__119basic_ostringstreamIcNS_11char_traitsIcEENS_9allocatorIcEEEE);

// Vtable aliases.
ALIAS(_ZTVNSt6__ndk113basic_ostreamIcNS_11char_traitsIcEEEE,
      _ZTVNSt3__113basic_ostreamIcNS_11char_traitsIcEEEE);
ALIAS(_ZTVNSt6__ndk114basic_ifstreamIcNS_11char_traitsIcEEEE,
      _ZTVNSt3__114basic_ifstreamIcNS_11char_traitsIcEEEE);
ALIAS(_ZTVNSt6__ndk114basic_ofstreamIcNS_11char_traitsIcEEEE,
      _ZTVNSt3__114basic_ofstreamIcNS_11char_traitsIcEEEE);
ALIAS(_ZTVNSt6__ndk115basic_streambufIcNS_11char_traitsIcEEEE,
      _ZTVNSt3__115basic_streambufIcNS_11char_traitsIcEEEE);
ALIAS(_ZTVNSt6__ndk115basic_stringbufIcNS_11char_traitsIcEENS_9allocatorIcEEEE,
      _ZTVNSt3__115basic_stringbufIcNS_11char_traitsIcEENS_9allocatorIcEEEE);
ALIAS(_ZTVNSt6__ndk117bad_function_callE,
      _ZTVNSt3__117bad_function_callE);
ALIAS(_ZTVNSt6__ndk118basic_stringstreamIcNS_11char_traitsIcEENS_9allocatorIcEEEE,
      _ZTVNSt3__118basic_stringstreamIcNS_11char_traitsIcEENS_9allocatorIcEEEE);
ALIAS(_ZTVNSt6__ndk119basic_istringstreamIcNS_11char_traitsIcEENS_9allocatorIcEEEE,
      _ZTVNSt3__119basic_istringstreamIcNS_11char_traitsIcEENS_9allocatorIcEEEE);
ALIAS(_ZTVNSt6__ndk119basic_ostringstreamIcNS_11char_traitsIcEENS_9allocatorIcEEEE,
      _ZTVNSt3__119basic_ostringstreamIcNS_11char_traitsIcEENS_9allocatorIcEEEE);

// Typeinfo aliases.
ALIAS(_ZTINSt6__ndk111regex_errorE,
      _ZTINSt3__111regex_errorE);
ALIAS(_ZTINSt6__ndk115basic_streambufIcNS_11char_traitsIcEEEE,
      _ZTINSt3__115basic_streambufIcNS_11char_traitsIcEEEE);
ALIAS(_ZTINSt6__ndk117bad_function_callE,
      _ZTINSt3__117bad_function_callE);
ALIAS(_ZTINSt6__ndk119__shared_weak_countE,
      _ZTINSt3__119__shared_weak_countE);

}  // extern "C"

#undef ALIAS

// ─── 3. JNI-safe probe ──────────────────────────────────────────────
// HybridPassportZk's companion init can dlsym this to verify the .so
// actually mapped and the constructor ran. `extern "C"` to avoid C++
// name mangling, default visibility so `dlsym(RTLD_DEFAULT, …)` finds
// it.
extern "C" __attribute__((visibility("default"))) int
solidarity_cxx_stream_shim_loaded(void) {
  return 1;
}
