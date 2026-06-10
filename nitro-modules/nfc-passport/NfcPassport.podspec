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

  # Hand-written Swift impl — nitrogen-generated files are added by
  # add_nitrogen_files() below.
  s.source_files = [
    'ios/**/*.{swift,h,m,mm}',
  ]

  # Passport trust resources. `masterList.pem` drives passive authentication;
  # `passportRevocationSnapshot*.json` is generated from ICAO PKD dsccrl LDIF
  # or CRL sources and feeds OpenAC v3 DSC revocation checks. The snapshot glob
  # intentionally matches only files that have been generated; missing
  # revocation input should fail in scripts/generate_masterlist.py, not here.
  #
  # Use the module-local asset copies so CocoaPods includes them in the host app
  # resources script. Paths outside the pod root are easy for local validation
  # to resolve but can be omitted from the generated Pods resource phase.
  s.resources = [
    'android/src/main/assets/masterList.pem',
    'android/src/main/assets/passportRevocationSnapshot.v3.json',
  ]

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION'  => '5.9',
  }

  # Real iOS ePassport NFC path. apps/expo/plugins/withNfcReader.js also
  # injects NFCPassportReader from GitHub into the generated Podfile so
  # CocoaPods resolves the 2.3.0 podspec even though newer releases are not
  # published through the trunk spec repo.
  s.dependency 'NFCPassportReader', '2.3.0'

  load File.join(__dir__, 'nitrogen', 'generated', 'ios', 'NfcPassport+autolinking.rb')
  add_nitrogen_files(s)

  # React Native build phase orchestration (Swift→C++ header ordering, etc.)
  install_modules_dependencies(s)
end
