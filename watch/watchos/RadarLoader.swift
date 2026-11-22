import SwiftUI
import UIKit

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRadar.kt `RadarState`
@MainActor
final class RadarStore: ObservableObject {
  @Published private(set) var frames: [RadarFrame] = []
  @Published private(set) var images: [Int64: UIImage] = [:]
  @Published private(set) var loading = false
  @Published private(set) var failed = false

  private var fetchedAtMs: Int64 = 0
  private var centre: RadarCentre?

  private static let timeout: TimeInterval = 10

  var loaded: [RadarFrame] { frames.filter { images[$0.timeSec] != nil } }

  func isStale(nowMs: Int64, latitude: Double, longitude: Double) -> Bool {
    radarIsStale(
      centre: centre, fetchedAtMs: fetchedAtMs, nowMs: nowMs,
      latitude: latitude, longitude: longitude
    )
  }

  func load(latitude: Double, longitude: Double) async {
    guard !loading else { return }
    loading = true
    failed = false
    defer { loading = false }

    guard let body = await fetch(RainViewer.metaURL),
      let meta = RainViewer.parseMeta(body),
      !meta.frames.isEmpty
    else {
      if !Task.isCancelled { failed = true }
      return
    }

    if meta.frames != frames {
      frames = meta.frames
      let live = Set(meta.frames.map(\.timeSec))
      images = images.filter { live.contains($0.key) }
    }
    centre = radarRoundedCentre(latitude: latitude, longitude: longitude)
    fetchedAtMs = Int64(Date().timeIntervalSince1970 * 1000)

    for frame in meta.frames {
      if Task.isCancelled { return }
      if images[frame.timeSec] != nil { continue }
      let url = RainViewer.frameURL(host: meta.host, frame: frame, latitude: latitude, longitude: longitude)
      guard let data = await fetch(url), let image = UIImage(data: data) else { continue }
      images[frame.timeSec] = image
    }
  }

  private func fetch(_ url: String) async -> Data? {
    guard let target = URL(string: url) else { return nil }
    var request = URLRequest(url: target)
    request.timeoutInterval = Self.timeout
    // intentional-suppression: the page reports the one failure that matters, and a cancelled
    guard let (data, response) = try? await URLSession.shared.data(for: request),
      let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
    else { return nil }
    return data
  }
}
