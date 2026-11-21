import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/ReplayRecordings.kt
internal enum ReplayRecordings {
  static func url(name: String) -> URL? {
    if let stored = DebugRecordingStore.recordingURL(name: name) { return stored }
    guard (name as NSString).lastPathComponent == name, name.hasSuffix(".jsonl") else { return nil }
    return bundledFixtureURLs().first { $0.lastPathComponent == name }
  }

  static func listBundled() -> [[String: Any]] {
    bundledFixtureURLs()
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
      .map { url in
        // intentional-suppression: fixture file size is optional metadata
        let sizeBytes = Int64((try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
        return ["name": url.lastPathComponent, "sizeBytes": sizeBytes]
      }
  }

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
