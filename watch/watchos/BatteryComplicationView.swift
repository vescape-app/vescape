import SwiftUI
import WidgetKit

/// The view used by WidgetKit and by the DEBUG simulator gallery.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/BatteryComplicationService.kt `batteryComplicationData`
/// @platform-diff A never-seen Board shows its name and `--` here; Wear OS returns No Data, the
///   watch face's own empty state.
struct BatteryComplicationView: View {
  let battery: WatchLastBattery?
  let date: Date
  let family: WidgetFamily
  private var text: String { battery?.text ?? "--" }
  private var age: String? { battery?.age(now: date) }
  private var ageLabel: String? { battery?.ageLabel(now: date) }
  private var color: Color { Palette.battery(for: battery?.percent) }
  private var value: Double { battery?.percent ?? 0 }

  var body: some View {
    Group {
      switch family {
      case .accessoryCorner:
        Color.clear
          .widgetLabel {
            Gauge(value: value, in: 0...100) { Text("Battery") }
              currentValueLabel: { Text("") }
              minimumValueLabel: { Text(text) }
              maximumValueLabel: { Text("") }
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
            if let ageLabel { Text(ageLabel).font(.caption2).foregroundStyle(.secondary) }
          }
          Gauge(value: value, in: 0...100) { Text("Battery") }
            .gaugeStyle(.accessoryLinearCapacity).tint(color).labelsHidden()
        }
      }
    }
    .foregroundStyle(color)
    .accessibilityLabel([battery?.boardName, text, ageLabel].compactMap { $0 }.joined(separator: ", "))
  }
}
