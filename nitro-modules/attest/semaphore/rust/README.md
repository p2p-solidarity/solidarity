# solidarity-semaphore-bindings

uniffi wrapper around [semaphore-rs](https://github.com/semaphore-protocol/semaphore-rs).

## Why this crate exists

The legacy SwiftUI app links against a pre-built static archive
(`libsemaphore_bindings.a`) that ships inside
`SemaphoreSwift/Sources/MoproiOSBindings/MoproBindings.xcframework`.
That archive was generated from an upstream uniffi shim, but the source
was never vendored into the monorepo. This crate re-creates that shim so
we can:

1. Re-build the iOS xcframework when bumping semaphore-rs.
2. Build the Android `.so` slices for `arm64-v8a`, `x86_64`,
   `armeabi-v7a` (no pre-built upstream artefact exists).

The exposed FFI surface MUST stay byte-compatible with the existing
`mopro.swift` (otherwise the Nitro module's iOS branch breaks because
the linker can't resolve the legacy symbol names against the new
archive). See `src/semaphore.udl`.

## Building

```bash
# iOS (rebuilds both arm64-device + arm64-simulator slices)
bash build-ios.sh

# Android (requires `cargo install cargo-ndk` + Android NDK on PATH)
bash build-android.sh
```

## Current status

- **iOS**: the existing xcframework in
  `SemaphoreSwift/Sources/MoproiOSBindings/MoproBindings.xcframework`
  is the source of truth right now — `mopro/SemaphoreBindings.podspec`
  links against it directly. Run `build-ios.sh` only when bumping
  semaphore-rs.
- **Android**: not yet built. `build-android.sh` is wired and ready to
  go but requires `cargo-ndk` + Android NDK on the build host. The
  Android `HybridSemaphore.kt` falls back to throwing
  `UnsupportedOperationException` until the `.so` lands under
  `android/src/main/jniLibs/<abi>/`.
