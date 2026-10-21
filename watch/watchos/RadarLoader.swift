import SwiftUI
import UIKit

/// The radar as the wrist has it: the frame list, plus the images that have arrived so far. Frames
/// appear one by one rather than all at once, so the page animates over what it has instead of
/// waiting on the slowest fetch.
///
/// **Lifecycle is the whole point.** ``load(latitude:longitude:)`` is driven from a SwiftUI `task`
/// keyed on the radar page's visibility, so leaving the page, going into the Always On state or
/// backgrounding the app cancels the structured task — and with it the in-flight `URLSession`
/// request — rather than letting a page nobody is looking at keep spending the watch's radio. There
/// is no detached task and no timer anywhere in here, which is what makes that cancellation
/// complete rather than advisory. A half-loaded animation is still worth showing, and the next
/// visit resumes from what already landed.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRadar.kt `RadarState`
@MainActor
final class RadarStore: ObservableObject {
  @Published private(set) var frames: [RadarFrame] = []
  /// Decoded frames, keyed by observation time. Pruned whenever the frame list moves on.
  @Published private(set) var images: [Int64: UIImage] = [:]
  @Published private(set) var loading = false
  /// The last attempt got nothing at all — no network, or a provider that answered with nonsense.
  /// Distinct from "no frames yet", which is what a first visit looks like.
  @Published private(set) var failed = false

  private var fetchedAtMs: Int64 = 0
  /// Where `images` were centred, so a rider who has moved re-fetches instead of showing elsewhere.
  private var centre: RadarCentre?

  private static let timeout: TimeInterval = 10

  /// Frames whose image has actually arrived, oldest first: the animation runs over what the watch
  /// has, and lengthens on its own as the rest land.
  var loaded: [RadarFrame] { frames.filter { images[$0.timeSec] != nil } }

  func isStale(nowMs: Int64, latitude: Double, longitude: Double) -> Bool {
    radarIsStale(
      centre: centre, fetchedAtMs: fetchedAtMs, nowMs: nowMs,
      latitude: latitude, longitude: longitude
    )
  }

  /// Fetch the frame list, then the images, oldest first. Every await is a cancellation point; a
  /// cancelled load leaves whatever it had already decoded in place.
  func load(latitude: Double, longitude: Double) async {
    guard !loading else { return }
    loading = true
    failed = false
    defer { loading = false }

    guard let body = await fetch(RainViewer.metaURL),
      let meta = RainViewer.parseMeta(body),
      !meta.frames.isEmpty
    else {
      // A cancelled load is not a failure: the rider left the page, and telling them the watch has
      // no network the next time they come back would be a lie.
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
      // A single missing frame just shortens the animation; only an empty frame list is a failure.
      guard let data = await fetch(url), let image = UIImage(data: data) else { continue }
      images[frame.timeSec] = image
    }
  }

  private func fetch(_ url: String) async -> Data? {
    guard let target = URL(string: url) else { return nil }
    var request = URLRequest(url: target)
    request.timeoutInterval = Self.timeout
    // intentional-suppression: the page reports the one failure that matters, and a cancelled
    // request must not be reported at all.
    guard let (data, response) = try? await URLSession.shared.data(for: request),
      let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
    else { return nil }
    return data
  }
}
