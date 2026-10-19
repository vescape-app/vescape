import SwiftUI
import WidgetKit

struct BatteryEntry: TimelineEntry {
  let date: Date
  let battery: WatchLastBattery?
}
struct BatteryProvider: TimelineProvider {
  func placeholder(in context: Context) -> BatteryEntry {
    BatteryEntry(date: .now, battery: WatchLastBattery(boardId: "preview", boardName: "X7", percent: 78, at: Int64(Date.now.timeIntervalSince1970 * 1000)))
  }
  func getSnapshot(in context: Context, completion: @escaping (BatteryEntry) -> Void) {
    completion(context.isPreview ? placeholder(in: context) : BatteryEntry(date: .now, battery: WatchBatteryDefaults.value))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<BatteryEntry>) -> Void) {
    let battery = WatchBatteryDefaults.value
    let now = Date.now
    let dates = battery?.timelineDates(now: now) ?? [now]
    completion(Timeline(entries: dates.map { BatteryEntry(date: $0, battery: battery) },
      policy: .after(dates.last!.addingTimeInterval(3600))))
  }
}
struct BatteryWidgetEntryView: View {
  @Environment(\.widgetFamily) private var family
  let entry: BatteryEntry
  var body: some View {
    BatteryComplicationView(battery: entry.battery, date: entry.date, family: family)
      .containerBackground(.black, for: .widget)
  }
}
@main
struct WatchBatteryWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: WatchBatteryDefaults.widgetKind, provider: BatteryProvider()) { entry in
      BatteryWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("Board battery")
    .description("The last battery reading from your selected board.")
    .supportedFamilies([.accessoryCorner, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}
