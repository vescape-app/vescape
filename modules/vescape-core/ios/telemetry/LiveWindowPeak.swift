import Foundation

/// Highest value of one metric across the live window, kept current per packet without rescanning
/// the window: a new sample can only raise it, so the window is rescanned only when the peak sample
/// rolls off. Not thread-safe; the owner's lock guards it.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/LiveWindowPeak.kt
/// @platform-diff iOS has no live metric-sanitizer exclusions, so nothing re-labels past samples and
/// there is no `invalidate`.
internal final class LiveWindowPeak {
  private let select: ([String: Any?]) -> Double?
  private var peak: Double?
  private var stale = false

  init(select: @escaping ([String: Any?]) -> Double?) {
    self.select = select
  }

  func add(_ row: [String: Any?]) {
    guard !stale, let value = select(row) else { return }
    if peak.map({ value > $0 }) ?? true { peak = value }
  }

  /// `row` left the window; the peak needs a rescan only if it was the peak sample.
  func evict(_ row: [String: Any?]) {
    if !stale, let peak, select(row) == peak { stale = true }
  }

  func reset() {
    peak = nil
    stale = false
  }

  func value(_ window: [[String: Any?]]) -> Double? {
    if stale {
      peak = window.compactMap(select).max()
      stale = false
    }
    return peak
  }
}
