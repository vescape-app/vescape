// swift-tools-version: 5.9

import Foundation
import PackageDescription

// `ios/` is the durable Swift source tree and CocoaPods compiles all of it into the app. This
// package exists so `bun run test:ios` can run the unit tests without an app build, so it compiles
// the same tree minus the files that need the Expo runtime.
//
// Sources are globbed, never listed. A hand-maintained allowlist silently drops whatever nobody
// remembers to add, which is how the GRDB migration tests ended up in no target at all. Globbing
// inverts the default: a new file under `ios/` is compiled, and one that cannot build here fails
// the run instead of disappearing from it.
//
// One catch: SwiftPM memoizes the evaluated manifest keyed on this file's *contents*, so a new
// source file alone would keep serving the old list. `scripts/test-ios.ts` drops that memo when the
// `ios/` file list moves — do not add files to the package by hand-editing lists here instead.

let iosRoot = URL(fileURLWithPath: #filePath)
  .deletingLastPathComponent()
  .appendingPathComponent("ios")

/// Imports `ExpoModulesCore`, which only exists inside the CocoaPods app build, plus whatever
/// depends on those files. Everything else in the tree is compiled and testable here.
let expoOwnedSources: Set<String> = [
  "VescapeCoreModule.swift",
  // `ExpoAppDelegateSubscriber`, the launch hook for CoreBluetooth state restoration.
  "connection/VescapeLaunchSubscriber.swift",
  // `NativeArrayBuffer` for the columnar Ride History payload.
  "telemetry/TelemetryRangePayload.swift",
]

/// Test-only helpers that are not themselves `XCTestCase` files, so the `*Tests.swift` rule misses
/// them. They use `@testable import VescapeCore` and belong in the test target.
let testSupportSources: Set<String> = [
  "replay/ConfigReplayHarness.swift"
]

/// Symlinks into `shared/`. The pod bundles all of them through `resource_bundles`; SPM only needs
/// the ones production code reads back out of its own bundle. Tests read fixtures straight off the
/// repo tree, so they need nothing here.
let bundledResources: Set<String> = [
  "cell-presets.json"
]

struct SourceTree {
  var library: [String] = []
  var tests: [String] = []
  /// Everything the target must be told to ignore: other targets' Swift files, the podspec, and the
  /// `shared/` symlinks that are not SPM resources.
  var ignored: [String] = []
}

func scan(_ directory: URL, prefix: String, into tree: inout SourceTree) {
  let keys: [URLResourceKey] = [.isDirectoryKey, .isSymbolicLinkKey]
  let entries = (try? FileManager.default.contentsOfDirectory(
    at: directory,
    includingPropertiesForKeys: keys,
    options: [.skipsHiddenFiles]
  )) ?? []

  for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
    let relativePath = prefix + entry.lastPathComponent
    let values = try? entry.resourceValues(forKeys: Set(keys))

    // Never follow a symlink: `fixtures` points at a whole shared directory, and resolving it would
    // pull the repo's fixture tree into the package.
    if values?.isSymbolicLink == true {
      if !bundledResources.contains(relativePath) { tree.ignored.append(relativePath) }
      continue
    }

    if values?.isDirectory == true {
      scan(entry, prefix: relativePath + "/", into: &tree)
      continue
    }

    guard entry.pathExtension == "swift", !expoOwnedSources.contains(relativePath) else {
      if !bundledResources.contains(relativePath) { tree.ignored.append(relativePath) }
      continue
    }

    if entry.lastPathComponent.hasSuffix("Tests.swift") || testSupportSources.contains(relativePath) {
      tree.tests.append(relativePath)
    } else {
      tree.library.append(relativePath)
    }
  }
}

var tree = SourceTree()
scan(iosRoot, prefix: "", into: &tree)

let grdb = Target.Dependency.product(name: "GRDB", package: "GRDB.swift")

let package = Package(
  name: "VescapeCore",
  // iOS only, matching `VescapeCore.podspec`: the tree uses UIKit, ActivityKit and CoreBluetooth.
  platforms: [.iOS(.v17)],
  products: [
    .library(name: "VescapeCore", targets: ["VescapeCore"])
  ],
  dependencies: [
    // The app ships 6.24.1 (`VescapeCore.podspec`) because that is the last GRDB published to
    // CocoaPods trunk. Tests cannot use it: no 6.x before 6.29.3 imports Darwin for `strcmp`, so
    // GRDB itself fails to compile under SPM on current Xcode. Same major line, so the migrator
    // semantics under test are the ones that ship.
    .package(url: "https://github.com/groue/GRDB.swift.git", .upToNextMajor(from: "6.29.3"))
  ],
  targets: [
    .target(
      name: "VescapeCore",
      dependencies: [grdb],
      path: "ios",
      exclude: tree.ignored + tree.tests,
      sources: tree.library,
      resources: bundledResources.sorted().map { .process($0) }
    ),
    .testTarget(
      name: "VescapeCoreTests",
      dependencies: ["VescapeCore", grdb],
      path: "ios",
      sources: tree.tests
    ),
  ]
)
