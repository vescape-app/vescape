#if DEBUG && targetEnvironment(simulator)
import SwiftUI
import WidgetKit

/// Simulator visual fixture. Each card renders the production complication view.
struct BatteryComplicationGallery: View {
  let state: String
  private var battery: WatchLastBattery? {
    guard state != "unknown" else { return nil }
    let now = Int64(Date.now.timeIntervalSince1970 * 1000)
    return WatchLastBattery(boardId: "fixture", boardName: "GT Beast",
      percent: state == "warning" ? 15 : 78, at: now - (state == "stale" ? 7_200_000 : 0))
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
  static var requested: String? {
    let args = ProcessInfo.processInfo.arguments
    guard let index = args.firstIndex(of: "--battery-preview"), args.indices.contains(index + 1) else { return nil }
    return args[index + 1]
  }
}
#endif
