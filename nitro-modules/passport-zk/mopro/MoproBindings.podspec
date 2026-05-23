require 'json'
# The package.json lives one dir up (the parent passport-zk pod owns it).
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# Sibling pod to PassportZK — isolates the mopro uniffi Swift wrapper and
# the static `passport_zk_moproFFI` xcframework into their own Swift module.
# PassportZK then depends on this and does an `@_implementationOnly import`,
# so mopro's internal types (RustBuffer, NoirProofResult, FfiConverter...)
# never leak into PassportZK's Swift→C++ interop header.
#
# Lives in mopro/ (one level below the package root) so that
# use_native_modules! autolinking still picks PassportZK.podspec for the
# `@solidarity/nitro-passport-zk` package.

Pod::Spec.new do |s|
  s.name         = 'MoproBindings'
  s.version      = package['version']
  s.summary      = 'mopro uniffi Swift wrapper isolated in its own module'
  s.homepage     = 'https://github.com/p2p-solidarity/airmeishi'
  s.license      = 'Apache-2.0'
  s.authors      = { 'Solidarity' => 'gm@solidarity.gg' }
  s.platforms    = { :ios => '17.0' }
  s.source       = { :git => 'https://github.com/p2p-solidarity/airmeishi.git' }

  s.source_files = [
    'ios/**/*.{swift,h}',
  ]

  # Path is relative to this podspec's dir (nitro-modules/passport-zk/mopro/).
  s.vendored_frameworks = [
    '../../../../passport-noir/mopro-binding/MoproiOSBindings/MoproBindings.xcframework',
  ]

  # The static `libpassport_zk_mopro.a` lives inside the xcframework but
  # CocoaPods doesn't auto-link it via `-l<name>` from `vendored_frameworks`
  # when the xcframework wraps a `.a` rather than a `.framework`. So we
  # add LIBRARY_SEARCH_PATHS + the explicit `-lpassport_zk_mopro` flag.
  # The path must resolve from the *app* target's working dir, so we use
  # an absolute path derived at podspec-evaluation time.
  xcf_abs   = File.expand_path(File.join(__dir__,
                '..', '..', '..', '..',
                'passport-noir', 'mopro-binding',
                'MoproiOSBindings', 'MoproBindings.xcframework'))
  xcf_root  = "${PODS_TARGET_SRCROOT}/../../../../passport-noir/mopro-binding/MoproiOSBindings/MoproBindings.xcframework"
  s.user_target_xcconfig = {
    'OTHER_LDFLAGS' => '$(inherited) -lpassport_zk_mopro',
    'LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*]' =>
      "$(inherited) \"#{xcf_abs}/ios-arm64-simulator\"",
    'LIBRARY_SEARCH_PATHS[sdk=iphoneos*]' =>
      "$(inherited) \"#{xcf_abs}/ios-arm64\"",
  }
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION'  => '5.9',
    'SWIFT_INCLUDE_PATHS[sdk=iphonesimulator*]' =>
      "#{xcf_root}/ios-arm64-simulator/Headers/passport_zk_mopro",
    'SWIFT_INCLUDE_PATHS[sdk=iphoneos*]' =>
      "#{xcf_root}/ios-arm64/Headers/passport_zk_mopro",
    'HEADER_SEARCH_PATHS[sdk=iphonesimulator*]' =>
      "$(inherited) #{xcf_root}/ios-arm64-simulator/Headers/passport_zk_mopro",
    'HEADER_SEARCH_PATHS[sdk=iphoneos*]' =>
      "$(inherited) #{xcf_root}/ios-arm64/Headers/passport_zk_mopro",
    'LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*]' =>
      "$(inherited) \"#{xcf_root}/ios-arm64-simulator\"",
    'LIBRARY_SEARCH_PATHS[sdk=iphoneos*]' =>
      "$(inherited) \"#{xcf_root}/ios-arm64\"",
    'OTHER_LDFLAGS' => '$(inherited) -lpassport_zk_mopro',
  }
end
