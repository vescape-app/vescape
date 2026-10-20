import Foundation

/// A rider colour resolved to components. Deliberately not a `Color`: this file is compiled into
/// the phone target too, and the wrist is the only place that paints with it.
struct WatchRiderColor: Equatable {
  var red: Double
  var green: Double
  var blue: Double
}

/// `#RRGGBB` / `#AARRGGBB` (the form the phone's rider palette stores) into components. Anything
/// else — blank, a colour name, a future format — is nil, which leaves the wrist on its own palette
/// rather than drawing a route in a colour nobody picked. Alpha is parsed and dropped: the wrist
/// draws its own opacity, and a rider colour that arrived half-transparent would read as a dim lane.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchSettings.kt `parseRiderColor`
func parseWatchRiderColor(_ value: String?) -> WatchRiderColor? {
  guard var hex = value?.trimmingCharacters(in: .whitespaces) else { return nil }
  if hex.hasPrefix("#") { hex.removeFirst() }
  guard hex.count == 6 || hex.count == 8 else { return nil }
  guard let rgb = UInt32(hex, radix: 16) else { return nil }
  return WatchRiderColor(
    red: Double((rgb >> 16) & 0xff) / 255,
    green: Double((rgb >> 8) & 0xff) / 255,
    blue: Double(rgb & 0xff) / 255
  )
}
