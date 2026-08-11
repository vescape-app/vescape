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
  # 17.0 matches the app deployment target required by Clerk's native iOS SDK. The Board Session
  # Live Activity driven from this pod needs 16.1+, so the app's floor also needs no availability
  # gating in its ActivityKit code.
  s.platform       = :ios, '17.0'
  s.swift_version  = '5.9'
  s.source         = { :git => '' }

  s.dependency 'ExpoModulesCore'
  # Single on-device database (mirrors Android Room). App data + telemetry live in one GRDB file.
  # 6.24.1 is the newest GRDB published to CocoaPods trunk; the 6.25–6.29 tags are SPM-only. The
  # SPM test target in `../Package.swift` therefore pins 6.29.3, the first 6.x that compiles under
  # SPM on current Xcode. Same major, same DatabaseMigrator semantics — see the note there.
  s.dependency 'GRDB.swift', '~> 6.24.1'

  # Swift/Objective-C compatibility
  s.static_framework = true
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift}"
  s.exclude_files = "**/*Tests.swift"

  # Bundle the canonical cell-preset SoC curves so the iOS BatterySocEstimator can estimate battery
  # percent. `cell-presets.json` is a symlink to the single shared source (../../../shared/data);
  # CocoaPods only copies resources under the pod root, and following the symlink keeps one source
  # of truth instead of a committed per-platform copy.
  # `fixtures/` holds bundled replay recordings for the dev-mode Replay UI (#230) and the screenshot
  # capture run. Unlike `cell-presets.json` it is a generated copy (`bun run copy:shared`), not a
  # symlink: CocoaPods resolves a symlinked file under the pod root but does not expand a glob
  # through a symlinked directory, so `fixtures/*.jsonl` silently matched nothing.
  s.resource_bundles = {
    'VescapeCoreAssets' => [
      'cell-presets.json',
      'legal-policies.json',
      'alerts/*.wav',
      'fixtures/*.jsonl'
    ]
  }

  s.test_spec 'Tests' do |test_spec|
    test_spec.source_files = "**/*Tests.swift"
  end
end
