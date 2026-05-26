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

  # CSCA Master List — concatenated PEM of country signing CA certificates.
  # NFCPassportReader.setMasterListURL(_:) needs this to verify the SOD
  # signature chain (passive authentication). Bundled as a top-level pod
  # resource so it ships inside the host app's main bundle, reachable via
  # `Bundle.main.url(forResource: "masterList", withExtension: "pem")`.
  #
  # Reference, do not duplicate: the bytes live with the Swift host app at
  # solidarity/Resources/masterList.pem. CocoaPods resolves this path
  # relative to the podspec.
  s.resources = ['../../solidarity/Resources/masterList.pem']

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION'  => '5.9',
  }

  # NFCPassportReader (AndyQ) is intentionally NOT a dependency here:
  # its transitive OpenSSL-Universal 3.3.x ships headers that break
  # Xcode 26's strict Clang module build ("@import inside extern \"C\"").
  # The Swift impl gates the import behind `canImport(NFCPassportReader)`
  # so this pod compiles into a stub on iOS while Android jmrtd remains
  # the production NFC path. Re-introduce when OpenSSL-Universal ships
  # clean headers, or swap to a hand-rolled ICAO 9303 reader.

  load File.join(__dir__, 'nitrogen', 'generated', 'ios', 'NfcPassport+autolinking.rb')
  add_nitrogen_files(s)

  # React Native build phase orchestration (Swift→C++ header ordering, etc.)
  install_modules_dependencies(s)
end
