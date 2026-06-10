require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'PassportZK'
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = 'https://github.com/p2p-solidarity/airmeishi'
  s.license      = 'Apache-2.0'
  s.authors      = { 'Solidarity' => 'gm@solidarity.gg' }
  s.platforms    = { :ios => '17.0' }
  s.source       = { :git => 'https://github.com/p2p-solidarity/airmeishi.git' }

  # Hand-written Hybrid Swift + the MoproShim wrapper. The mopro uniffi
  # bindings live in the sibling `MoproBindings` pod so its types
  # (RustBuffer, NoirProofResult, FfiConverter…) stay out of this pod's
  # Swift→C++ interop header, which Nitro generates for HybridPassportZkSpec.
  s.source_files = [
    'ios/**/*.{swift,h,m,mm}',
  ]
  # One circuit manifest per circuit (small, checked in) + a SINGLE merged SRS.
  # barretenberg's SRS is a prefix, so `passport.srs.bin` (sized to the largest
  # of the three circuits) serves all of them — half the bundle vs one SRS each.
  # The .srs.bin is gitignored and produced by `make gen-srs` / build-android.sh.
  s.resources = [
    'android/src/main/assets/dsc_chain.json',
    'android/src/main/assets/passport_adapter.json',
    'android/src/main/assets/openac_show.json',
    'android/src/main/assets/passport.srs.bin',
  ]

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION'  => '5.9',
  }

  s.dependency 'MoproBindings'

  load File.join(__dir__, 'nitrogen', 'generated', 'ios', 'PassportZK+autolinking.rb')
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
