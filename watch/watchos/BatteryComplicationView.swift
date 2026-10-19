import SwiftUI
import WidgetKit

/// The view used by WidgetKit and by the DEBUG simulator gallery.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/BatteryComplicationService.kt
struct BatteryComplicationView: View {
  let battery: WatchLastBattery?
  let date: Date
  let family: WidgetFamily
  private var text: String { battery?.text ?? "--" }
  private var age: String? { battery?.age(now: date) }
  private var color: Color { Palette.battery(for: battery?.percent) }
  private var value: Double { battery?.percent ?? 0 }

  var body: some View {
    Group {
      switch family {
      case .accessoryCorner:
        Text(text).font(.system(.title3, design: .rounded).weight(.semibold))
          .widgetLabel {
            Gauge(value: value, in: 0...100) { Text("Battery") }
              .tint(color)
          }
      case .accessoryCircular:
        Gauge(value: value, in: 0...100) { Image(systemName: "battery.100percent") }
          currentValueLabel: { Text(text).minimumScaleFactor(0.7) }
          .gaugeStyle(.accessoryCircularCapacity).tint(color)
      case .accessoryInline:
        Text([text, age].compactMap { $0 }.joined(separator: " · "))
      default:
        VStack(alignment: .leading, spacing: 3) {
          Text(battery?.boardName ?? "Board battery").font(.headline).lineLimit(1)
          HStack(alignment: .firstTextBaseline) {
            Text(text).font(.system(.title2, design: .rounded).weight(.semibold))
            Spacer(minLength: 2)
            if let age { Text("\(age) ago").font(.caption2).foregroundStyle(.secondary) }
          }
          Gauge(value: value, in: 0...100) { Text("Battery") }
            .gaugeStyle(.accessoryLinearCapacity).tint(color).labelsHidden()
        }
      }
    }
    .foregroundStyle(color)
    .accessibilityLabel([battery?.boardName, text, age.map { "\($0) ago" }].compactMap { $0 }.joined(separator: ", "))
  }
}
