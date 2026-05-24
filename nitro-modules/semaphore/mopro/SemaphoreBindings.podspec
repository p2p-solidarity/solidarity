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

  # The xcframework + libsemaphore_bindings.a are produced by
  # rust/build-ios.sh (see that script). For now we reuse the already-built
  # binary in the sibling SemaphoreSwift project — it's the same crate the
  # legacy SwiftUI app links against, so commitments are byte-identical out
  # of the gate.
  s.vendored_frameworks = [
    '../../../../SemaphoreSwift/Sources/MoproiOSBindings/MoproBindings.xcframework',
  ]

  # CocoaPods doesn't auto-`-l` a static `.a` wrapped in an xcframework
  # (only true `.framework`s get implicit linkage), so spell out
  # LIBRARY_SEARCH_PATHS and `-lsemaphore_bindings` explicitly. Paths
  # use the absolute on-disk location resolved at podspec-evaluation
  # time so they survive `pod install`'s working-dir changes.
  xcf_abs   = File.expand_path(File.join(__dir__,
                '..', '..', '..', '..',
                'SemaphoreSwift', 'Sources', 'MoproiOSBindings',
                'MoproBindings.xcframework'))
  xcf_root  = "${PODS_TARGET_SRCROOT}/../../../../SemaphoreSwift/Sources/MoproiOSBindings/MoproBindings.xcframework"
  # Only the `-l<name>` link flag here — SDK-conditional
  # `LIBRARY_SEARCH_PATHS[sdk=*]` lives in apps/expo/ios/Podfile's
  # `post_install` hook. CocoaPods can't merge SDK-conditional keys
  # across the two bindings pods and bails with "Can't merge
  # user_target_xcconfig", so the Podfile injects them directly.
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
    'OTHER_LDFLAGS' => '$(inherited) -lsemaphore_bindings',
  }
end
