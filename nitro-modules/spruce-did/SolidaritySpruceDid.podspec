require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'SolidaritySpruceDid'
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

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION'  => '5.9',
    # The Spruce SDK is integrated via Swift Package Manager (`sprucekit-mobile`).
    # The consuming app's Xcode project resolves the package; we just need to
    # be able to `import SpruceIDMobileSdkRs` at compile time.
    'OTHER_SWIFT_FLAGS' => '$(inherited)',
  }

  # SpruceID iOS SDK integration — same pattern as the legacy app.
  #
  # Pod consumers MUST add this SPM package to their Xcode project:
  #
  #   File → Add Package Dependencies → https://github.com/spruceid/sprucekit-mobile
  #   Branch: main (or pin to a specific version, e.g. 0.14.10)
  #   Products: SpruceIDMobileSdk + SpruceIDMobileSdkRs
  #
  # For Expo projects, this is wired via a config plugin
  # (`apps/expo/plugins/withSpruceIdSpmPackage.js`) that injects the SPM
  # reference into the generated Xcode project on every `expo prebuild`.
  # See `apps/expo/plugins/withSpruceIdSpmPackage.js`.

  load File.join(__dir__, 'nitrogen', 'generated', 'ios', 'SolidaritySpruceDid+autolinking.rb')
  add_nitrogen_files(s)

  # React Native build phase orchestration (Swift→C++ header ordering, etc.)
  install_modules_dependencies(s)
end
