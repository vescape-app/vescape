import Foundation

/// Resolves a replayable Debug Recording by name: the on-device store first, then the bundled
/// fixtures shipped in the `VescapeCoreAssets` resource bundle (symlinked from `shared/fixtures/`
/// via the podspec). Bundled fixtures make replay usable on a device with no captures yet.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/ReplayRecordings.kt
internal enum ReplayRecordings {
  /// Resolve a recording to a readable URL: on-device store first, bundled fixture second.
  static func url(name: String) -> URL? {
    if let stored = DebugRecordingStore.recordingURL(name: name) { return stored }
    guard (name as NSString).lastPathComponent == name, name.hasSuffix(".jsonl") else { return nil }
    return bundledFixtureURLs().first { $0.lastPathComponent == name }
  }

  /// Bundled fixture names + sizes, sorted by name (bundle resources have no capture timestamps).
  static func listBundled() -> [[String: Any]] {
    bundledFixtureURLs()
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
      .map { url in
        // intentional-suppression: fixture file size is optional metadata
        let sizeBytes = Int64((try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
        return ["name": url.lastPathComponent, "sizeBytes": sizeBytes]
      }
  }

  /// Fixture `.jsonl` files. The dedicated `VescapeCoreAssets` resource bundle is authoritative
  /// (only fixtures glob `.jsonl` there); the bare module bundle is a fallback for builds without
  /// the CocoaPods bundle step, checked second so stray `.jsonl` files can never shadow fixtures.
  private static func bundledFixtureURLs() -> [URL] {
    let moduleBundle = Bundle(for: DebugRecordingStore.self)
    let bundles = [
      moduleBundle.url(forResource: "VescapeCoreAssets", withExtension: "bundle").flatMap { Bundle(url: $0) },
      moduleBundle,
    ]
    for case let bundle? in bundles {
      let urls = bundle.urls(forResourcesWithExtension: "jsonl", subdirectory: nil) ?? []
      if !urls.isEmpty { return urls }
    }
    return []
  }
}
