require 'json'
# The package.json lives one dir up (the parent Semaphore pod owns it).
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# Sibling pod to Semaphore — isolates the semaphore-rs uniffi Swift wrapper
# (`mopro.swift`) and the static `libsemaphore_bindings.a` xcframework into
# their own Swift module. The hand-written `HybridSemaphore.swift` then does
# `@_implementationOnly import SemaphoreBindings` so the uniffi internal
# types (RustBuffer, FfiConverter, Group, Identity…) NEVER leak into the
# Swift→C++ interop header that Nitrogen generates for HybridSemaphoreSpec.
#
# Pattern is identical to passport-zk/mopro/MoproBindings.podspec — see
# that file for the rationale on absolute-path xcframework + explicit
# `-lsemaphore_bindings` link flag.
#
# Lives in mopro/ (one level below the package root) so that
# use_native_modules! autolinking still picks Semaphore.podspec for the
# `@solidarity/nitro-semaphore` package.

Pod::Spec.new do |s|
  s.name         = 'SemaphoreBindings'
  s.version      = package['version']
  s.summary      = 'semaphore-rs uniffi Swift wrapper isolated in its own module'
  s.homepage     = 'https://github.com/p2p-solidarity/airmeishi'
  s.license      = 'Apache-2.0'
  s.authors      = { 'Solidarity' => 'gm@solidarity.gg' }
  s.platforms    = { :ios => '17.0' }
  s.source       = { :git => 'https://github.com/p2p-solidarity/airmeishi.git' }

  s.source_files = [
    'ios/**/*.{swift,h}',
  ]

  # The xcframework + libsemaphore_bindings.a are produced locally by
  # nitro-modules/semaphore/rust/build-ios.sh — they sit next to this
  # podspec inside SemaphoreBindings.xcframework. Re-run that script
  # after any change to rust/src/* or the UDL so the static lib's
  # symbol checksums stay in sync with mopro/ios/mopro.swift.
  s.vendored_frameworks = [
    'SemaphoreBindings.xcframework',
  ]

  # CocoaPods doesn't auto-`-l` a static `.a` wrapped in an xcframework
  # (only true `.framework`s get implicit linkage), so spell out
  # `-lsemaphore_bindings` explicitly. The Swift glue imports the UniFFI
  # C shim as `semaphore_bindingsFFI`; its module map lives one level below
  # the xcframework Headers root, so expose that subdirectory directly.
  #
  # The app target's SDK-conditional LIBRARY_SEARCH_PATHS lives in
  # apps/expo/ios/Podfile's `post_install` hook. Centralising the app-level
  # paths there avoids CocoaPods bailing with "Can't merge user_target_xcconfig"
  # when two bindings pods both contribute different paths.
  xcf_root = "${PODS_TARGET_SRCROOT}/SemaphoreBindings.xcframework"
  s.user_target_xcconfig = {
    'OTHER_LDFLAGS' => '$(inherited) -lsemaphore_bindings',
  }
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION'  => '5.9',
    'SWIFT_INCLUDE_PATHS[sdk=iphonesimulator*]' =>
      "#{xcf_root}/ios-arm64-simulator/Headers/semaphore_bindings",
    'SWIFT_INCLUDE_PATHS[sdk=iphoneos*]' =>
      "#{xcf_root}/ios-arm64/Headers/semaphore_bindings",
    'HEADER_SEARCH_PATHS[sdk=iphonesimulator*]' =>
      "$(inherited) #{xcf_root}/ios-arm64-simulator/Headers/semaphore_bindings",
    'HEADER_SEARCH_PATHS[sdk=iphoneos*]' =>
      "$(inherited) #{xcf_root}/ios-arm64/Headers/semaphore_bindings",
    'LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*]' =>
      "$(inherited) \"#{xcf_root}/ios-arm64-simulator\"",
    'LIBRARY_SEARCH_PATHS[sdk=iphoneos*]' =>
      "$(inherited) \"#{xcf_root}/ios-arm64\"",
    'OTHER_LDFLAGS'  => '$(inherited) -lsemaphore_bindings',
  }
end
