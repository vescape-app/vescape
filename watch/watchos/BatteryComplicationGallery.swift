#if DEBUG && targetEnvironment(simulator)
import SwiftUI
import WidgetKit

/// Simulator visual fixture. Each card renders the production complication view.
struct BatteryComplicationGallery: View {
  let state: String
  private var battery: WatchLastBattery? { Self.battery(for: state) }

  private static func battery(for state: String) -> WatchLastBattery? {
    guard state != "unknown" else { return nil }
    let now = Int64(Date.now.timeIntervalSince1970 * 1000)
    return WatchLastBattery(boardId: "fixture", boardName: "GT Beast",
      percent: state == "warning" ? 15 : 78, at: now - (state == "stale" ? 7_200_000 : 0))
  }

  /// Explicit simulator-only fixture for actual watch-face slots, using the production App Group.
  /// The launch delegate skips WatchConnectivity so phone context cannot overwrite the fixture.
  static func seedRequestedFixture() -> Bool {
    guard let state = requestedFixture else { return false }
    _ = WatchBatteryDefaults.receiveLatestContext({ [watchLastBatteryChannel: battery(for: state)?.payload ?? [:]] })
    WidgetCenter.shared.reloadTimelines(ofKind: WatchBatteryDefaults.widgetKind)
    return true
  }
  var body: some View {
    GeometryReader { geometry in
      VStack(spacing: 4) {
        Text("DEBUG · \(state)").font(.system(size: 10)).foregroundStyle(.secondary)
        BatteryComplicationView(battery: battery, date: .now, family: .accessoryRectangular)
          .padding(6).background(.gray.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
        HStack {
          BatteryComplicationView(battery: battery, date: .now, family: .accessoryCircular).frame(width: 48, height: 48)
          BatteryComplicationView(battery: battery, date: .now, family: .accessoryCorner).frame(width: 48, height: 48)
        }
        BatteryComplicationView(battery: battery, date: .now, family: .accessoryInline)
        Text("Corner curve requires watch face").font(.system(size: 8)).foregroundStyle(.secondary)
      }.padding(.horizontal, 8)
        .scaleEffect(0.82)
        .frame(width: geometry.size.width, height: geometry.size.height, alignment: .center)
        .offset(y: 8)
    }
  }
  static var requested: String? { argument("--battery-preview") }
  static var requestedFixture: String? { argument("--battery-fixture") }

  private static func argument(_ flag: String) -> String? {
    let args = ProcessInfo.processInfo.arguments
    guard let index = args.firstIndex(of: flag), args.indices.contains(index + 1),
      ["healthy", "warning", "stale", "unknown"].contains(args[index + 1]) else { return nil }
    return args[index + 1]
  }
}
#endif
