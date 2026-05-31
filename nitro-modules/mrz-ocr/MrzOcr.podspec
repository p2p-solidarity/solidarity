require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'MrzOcr'
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = 'https://github.com/p2p-solidarity/airmeishi'
  s.license      = 'Apache-2.0'
  s.authors      = { 'Solidarity' => 'gm@solidarity.gg' }
  s.platforms    = { :ios => '17.0' }
  s.source       = { :git => 'https://github.com/p2p-solidarity/airmeishi.git' }

  # Hand-written Swift impl — nitrogen-generated files are added by
  # add_nitrogen_files() below.
  s.source_files = [
    'ios/**/*.{swift,h,m,mm}',
  ]

  # Expose the Objective-C exception barrier (MrzVisionGuard) in the pod's
  # umbrella so the pod's own Swift can call MrzPerformVisionRequest without a
  # bridging header (CocoaPods pods can't use one). Pods can't catch an
  # NSException from Swift; this guard does it in ObjC. See MrzVisionGuard.h.
  s.public_header_files = 'ios/MrzVisionGuard.h'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION'  => '5.9',
  }

  # VisionCamera is required so we can downcast `any HybridFrameSpec` to
  # the concrete `HybridFrame` and read its CMSampleBuffer / CVPixelBuffer
  # in `HybridMrzOcr.swift`.
  s.dependency 'VisionCamera'

  # Vision ships with the iOS SDK. Swift's `import Vision` auto-links it, but
  # MrzVisionGuard.mm calls VNImageRequestHandler via the framework header, so
  # link it explicitly to be safe.
  s.frameworks = 'Vision'

  load File.join(__dir__, 'nitrogen', 'generated', 'ios', 'MrzOcr+autolinking.rb')
  add_nitrogen_files(s)

  # React Native build phase orchestration (Swift→C++ header ordering, etc.)
  install_modules_dependencies(s)
end
