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

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION'  => '5.9',
  }

  s.dependency 'MoproBindings'

  load File.join(__dir__, 'nitrogen', 'generated', 'ios', 'PassportZK+autolinking.rb')
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
