require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'VescapeCore'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = 'vescape'
  s.homepage       = 'https://github.com/vescape'
  s.platform       = :ios, '17.0'
  s.swift_version  = '5.9'
  s.source         = { :git => '' }

  s.dependency 'ExpoModulesCore'
  s.dependency 'GRDB.swift', '~> 6.24.1'
  s.dependency 'Sentry/HybridSDK', '8.58.0'

  s.static_framework = true
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift}"
  s.exclude_files = "**/*Tests.swift"

  s.resource_bundles = {
    'VescapeCoreAssets' => [
      'cell-presets.json', 'alert-preset-definitions.json',
      'legal-policies.json',
      'alert-packs',
      'fixtures/*.jsonl'
    ]
  }

  s.test_spec 'Tests' do |test_spec|
    test_spec.source_files = "**/*Tests.swift"
  end
end
