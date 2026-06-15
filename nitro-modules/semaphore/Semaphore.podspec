require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'Semaphore'
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = 'https://github.com/p2p-solidarity/airmeishi'
  s.license      = 'Apache-2.0'
  s.authors      = { 'Solidarity' => 'gm@solidarity.gg' }
  s.platforms    = { :ios => '17.0' }
  s.source       = { :git => 'https://github.com/p2p-solidarity/airmeishi.git' }

  # Hand-written Hybrid Swift + the SemaphoreShim wrapper. The semaphore-rs
  # uniffi bindings live in the sibling `SemaphoreBindings` pod so its
  # types (RustBuffer, Identity, Group, FfiConverter…) stay out of this
  # pod's Swift→C++ interop header that Nitro generates for HybridSemaphoreSpec.
  s.source_files = [
    'ios/**/*.{swift,h,m,mm}',
  ]

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION'  => '5.9',
  }

  s.dependency 'SemaphoreBindings'

  load File.join(__dir__, 'nitrogen', 'generated', 'ios', 'Semaphore+autolinking.rb')
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
