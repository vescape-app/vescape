// swift-tools-version: 5.9

import Foundation
import PackageDescription

let iosRoot = URL(fileURLWithPath: #filePath)
  .deletingLastPathComponent()
  .appendingPathComponent("ios")

let expoOwnedSources: Set<String> = [
  "VescapeCoreModule.swift",
  "connection/VescapeLaunchSubscriber.swift",
  "telemetry/TelemetryRangePayload.swift",
]

let testSupportSources: Set<String> = [
  "replay/ConfigReplayHarness.swift",
  "accessory/AccessoryFixtures.swift",
]

let bundledResources: Set<String> = [
  "cell-presets.json", "alert-preset-definitions.json", "refloat-field-overlay.json"
]

struct SourceTree {
  var library: [String] = []
  var tests: [String] = []
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
  platforms: [.iOS(.v17), .macOS(.v13)],
  products: [
    .library(name: "VescapeCore", targets: ["VescapeCore"]),
    .executable(name: "RecordingPersistenceHost", targets: ["RecordingPersistenceHost"])
  ],
  dependencies: [
    .package(url: "https://github.com/groue/GRDB.swift.git", .upToNextMajor(from: "6.29.3"))
  ],
  targets: [
    .target(
      name: "VescapeCore",
      dependencies: [grdb],
      path: "ios",
      exclude: tree.ignored + tree.tests + bundledResources.sorted(),
      sources: tree.library,
      plugins: ["SharedResourcesPlugin"]
    ),
    .testTarget(
      name: "VescapeCoreTests",
      dependencies: ["VescapeCore", grdb],
      path: "ios",
      sources: tree.tests
    ),
    .executableTarget(
      name: "RecordingPersistenceHost",
      dependencies: [grdb],
      path: "persistence-macos",
      exclude: bundledResources.sorted(),
      plugins: ["SharedResourcesPlugin"]
    ),
    .plugin(name: "SharedResourcesPlugin", capability: .buildTool()),
  ]
)
