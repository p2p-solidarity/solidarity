require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'NfcPassport'
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = 'https://github.com/p2p-solidarity/airmeishi'
  s.license      = 'Apache-2.0'
  s.authors      = { 'Solidarity' => 'gm@solidarity.gg' }
  s.platforms    = { :ios => '17.0' }
  s.source       = { :git => 'https://github.com/p2p-solidarity/airmeishi.git' }

  s.source_files = [
    'ios/**/*.{swift,h,m,mm}',
    'nitrogen/generated/ios/**/*.{swift,h,hpp,m,mm,cpp}',
  ]
  s.public_header_files = 'nitrogen/generated/ios/**/*.{h,hpp}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE'   => 'YES',
    'SWIFT_VERSION'    => '5.9',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
  }

  load File.join(__dir__, 'nitrogen', 'generated', 'ios', 'NfcPassport+autolinking.rb')
  add_nitrogen_files(s)
end
