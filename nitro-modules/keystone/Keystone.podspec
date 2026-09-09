require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'Keystone'
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = 'https://github.com/p2p-solidarity/airmeishi'
  s.license      = 'Apache-2.0'
  s.authors      = { 'Solidarity' => 'gm@solidarity.gg' }
  s.platforms    = { :ios => '17.0' }
  s.source       = { :git => 'https://github.com/p2p-solidarity/airmeishi.git' }

  # Hand-written Swift impls for the three HybridObjects (SecretsVault,
  # SpruceDid, CloudKit) — nitrogen-generated files are added by
  # add_nitrogen_files() below.
  s.source_files = [
    'ios/**/*.{swift,h,m,mm}',
  ]

  # Apple frameworks. Security exposes SecAccessControl / Keychain helpers;
  # CryptoKit ships the SecureEnclave + HKDF + AES-GCM primitives;
  # LocalAuthentication gates the biometric paths; CryptoTokenKit names the
  # Secure-Enclave token error codes the sign-recovery policy classifies
  # (SpruceDidSignFailure); CloudKit backs the
  # iCloud Drive ubiquity-container file backup.
  s.frameworks = ['CryptoKit', 'CryptoTokenKit', 'Security', 'Foundation', 'LocalAuthentication', 'CloudKit']

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION'  => '5.9',
  }

  load File.join(__dir__, 'nitrogen', 'generated', 'ios', 'Keystone+autolinking.rb')
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
