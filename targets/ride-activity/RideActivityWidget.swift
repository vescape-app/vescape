import ActivityKit
import SwiftUI
import WidgetKit

/// Widget bundle entry point for the `ride-activity` extension. Only hosts the Live Activity — the
/// board status surface — so there is no Home Screen widget alongside it.
@main
struct RideActivityBundle: WidgetBundle {
  var body: some Widget {
    RideActivityWidget()
  }
}

/// Renders the Board Session Live Activity from `RideActivityAttributes`. Native code owns all
/// state transitions; these views are pure functions of `context.state`.
struct RideActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RideActivityAttributes.self) { context in
      RideActivityLockScreenView(state: context.state, isStale: context.isStale)
        .padding()
        .activityBackgroundTint(Color.black.opacity(0.55))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label(context.state.deviceName, systemImage: boardSymbol(context.state, context.isStale))
            .font(.caption)
            .lineLimit(1)
            .opacity(context.isStale ? staleOpacity : 1)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(context.isStale ? staleShortCritical : context.state.shortCritical)
            .font(.caption.weight(.semibold))
            .foregroundStyle(statusColor(context.state, context.isStale))
        }
        DynamicIslandExpandedRegion(.bottom) {
          RideActivityDetails(state: context.state, isStale: context.isStale)
        }
      } compactLeading: {
        Image(systemName: boardSymbol(context.state, context.isStale))
          .foregroundStyle(statusColor(context.state, context.isStale))
      } compactTrailing: {
        Text(context.isStale ? staleShortCritical : context.state.shortCritical)
          .font(.caption2.weight(.semibold))
      } minimal: {
        Image(systemName: boardSymbol(context.state, context.isStale))
          .foregroundStyle(statusColor(context.state, context.isStale))
      }
    }
  }
}

/// Full Lock Screen / banner presentation.
private struct RideActivityLockScreenView: View {
  let state: RideActivityAttributes.ContentState
  let isStale: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      // No `shortCritical` here: the status line below already carries the battery segment plus the
      // progress bar, so a second big percent is pure duplication. The compact Dynamic Island, which
      // has no room for a status line, still renders it.
      Label(state.deviceName, systemImage: boardSymbol(state, isStale))
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(statusColor(state, isStale))
        .lineLimit(1)
      RideActivityDetails(state: state, isStale: isStale)
    }
    .opacity(isStale ? staleOpacity : 1)
  }
}

/// Shared details and authenticated native stop for the Lock Screen and expanded Dynamic Island.
private struct RideActivityDetails: View {
  let state: RideActivityAttributes.ContentState
  let isStale: Bool

  var body: some View {
    HStack(alignment: .bottom, spacing: 12) {
      RideStatusRow(state: state, isStale: isStale)
      Spacer(minLength: 8)
      Button(intent: StopRideIntent()) {
        Label("Stop ride", systemImage: "stop.fill")
          .font(.caption.weight(.semibold))
      }
      .buttonStyle(.borderedProminent)
      .tint(isStale ? .gray : .red)
    }
  }
}

/// Shared status line + battery progress, used by both the Lock Screen and the expanded island.
private struct RideStatusRow: View {
  let state: RideActivityAttributes.ContentState
  let isStale: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(isStale ? staleStatusText : state.statusText)
        .font(.footnote)
        .foregroundStyle(staleAware(state.faultCode != nil ? Color.orange : Color.secondary))
        .lineLimit(1)
      if let battery = state.batteryPercent, !isStale {
        ProgressView(value: Double(battery), total: 100)
          .tint(batteryTint(battery))
      }
    }
  }

  private func staleAware(_ color: Color) -> Color { isStale ? .secondary : color }
}

/// The activity outlived its `staleDate`: nothing has pushed a snapshot for a minute, so the numbers
/// on screen are history, not telemetry. Deliberately not phrased as "ride ended" — stale means
/// unknown, not terminal: the app is usually dead (killed or jetsammed), but a suspended process can
/// still come back. The widget extension cannot ask the app anything, so `context.isStale` is the
/// only signal there is.
private let staleStatusText = "No connection to the app"
private let staleShortCritical = "—"
private let staleOpacity = 0.45

private func boardSymbol(_ state: RideActivityAttributes.ContentState, _ isStale: Bool) -> String {
  if isStale { return "bolt.slash" }
  if state.faultCode != nil { return "exclamationmark.triangle.fill" }
  switch state.phase {
  case "connected": return "bolt.fill"
  case "error": return "xmark.circle.fill"
  case "idle": return "bolt.slash"
  default: return "bolt.horizontal"
  }
}

private func statusColor(_ state: RideActivityAttributes.ContentState, _ isStale: Bool) -> Color {
  if isStale { return .secondary }
  if state.faultCode != nil { return .orange }
  switch state.phase {
  case "connected": return .green
  case "error": return .red
  default: return .yellow
  }
}

private func batteryTint(_ percent: Int) -> Color {
  switch percent {
  case ..<15: return .red
  case ..<30: return .orange
  default: return .green
  }
}
