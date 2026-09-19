require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'Attest'
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = 'https://github.com/p2p-solidarity/airmeishi'
  s.license      = 'Apache-2.0'
  s.authors      = { 'Solidarity' => 'gm@solidarity.gg' }
  s.platforms    = { :ios => '17.0' }
  s.source       = { :git => 'https://github.com/p2p-solidarity/airmeishi.git' }

  # Hand-written Hybrid Swift for the four HybridObjects (MrzOcr,
  # NfcPassport, PassportZk, Semaphore) plus the MoproShim / SemaphoreShim
  # wrappers. The uniffi bindings live in the sibling `MoproBindings` and
  # `SemaphoreBindings` pods so their types (RustBuffer, FfiConverter…)
  # stay out of this pod's Swift→C++ interop header, which Nitro generates
  # for the Hybrid*Spec classes.
  s.source_files = [
    'ios/**/*.{swift,h,m,mm}',
  ]

  # Expose the Objective-C exception barrier (MrzVisionGuard) in the pod's
  # umbrella so the pod's own Swift can call MrzPerformVisionRequest without a
  # bridging header (CocoaPods pods can't use one). Pods can't catch an
  # NSException from Swift; this guard does it in ObjC. See MrzVisionGuard.h.
  s.public_header_files = 'ios/MrzVisionGuard.h'

  # Passport resources.
  #   - One circuit manifest per circuit (small, checked in) + a SINGLE merged
  #     SRS. barretenberg's SRS is a prefix, so `passport.srs.bin` (sized to
  #     the largest of the three circuits) serves all of them — half the
  #     bundle vs one SRS each. The .srs.bin is gitignored and produced by
  #     `scripts/stage-openac-srs.sh` / build-android.sh.
  #   - `masterList.pem` drives passive authentication;
  #     `passportRevocationSnapshot*.json` feeds OpenAC v3 DSC revocation
  #     checks. Module-local asset copies so CocoaPods includes them in the
  #     host app resources script.
  s.resources = [
    'android/src/main/assets/dsc_chain.json',
    'android/src/main/assets/passport_adapter.json',
    'android/src/main/assets/openac_show.json',
    'android/src/main/assets/passport.srs.bin',
    'android/src/main/assets/masterList.pem',
    'android/src/main/assets/passportRevocationSnapshot.v3.json',
  ]

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION'  => '5.9',
  }

  # Vision ships with the iOS SDK. Swift's `import Vision` auto-links it, but
  # MrzVisionGuard.mm calls VNImageRequestHandler via the framework header, so
  # link it explicitly to be safe.
  s.frameworks = 'Vision'

  s.dependency 'MoproBindings'
  s.dependency 'SemaphoreBindings'

  # VisionCamera is required so we can downcast `any HybridFrameSpec` to
  # the concrete `HybridFrame` and read its CMSampleBuffer / CVPixelBuffer
  # in `HybridMrzOcr.swift`.
  s.dependency 'VisionCamera'

  # Real iOS ePassport NFC path. apps/expo/plugins/withNfcReader.js also
  # injects NFCPassportReader from GitHub into the generated Podfile so
  # CocoaPods resolves the 2.3.0 podspec even though newer releases are not
  # published through the trunk spec repo.
  s.dependency 'NFCPassportReader', '2.3.0'

  load File.join(__dir__, 'nitrogen', 'generated', 'ios', 'Attest+autolinking.rb')
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
