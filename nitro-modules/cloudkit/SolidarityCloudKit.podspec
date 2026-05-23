require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'SolidarityCloudKit'
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

  # Apple frameworks we link against. CloudKit is the only required link;
  # Foundation is implicit. UIKit is optional — only pulled for sharing UI
  # if we ever surface UICloudSharingController; v1 keeps the share URL
  # string-based so we avoid pulling UIKit into the module.
  s.frameworks = ['CloudKit', 'Foundation']

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION'  => '5.9',
  }

  load File.join(__dir__, 'nitrogen', 'generated', 'ios', 'SolidarityCloudKit+autolinking.rb')
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
