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
      RideActivityLockScreenView(state: context.state)
        .padding()
        .activityBackgroundTint(Color.black.opacity(0.55))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label(context.state.deviceName, systemImage: boardSymbol(context.state))
            .font(.caption)
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(context.state.shortCritical)
            .font(.caption.weight(.semibold))
            .foregroundStyle(statusColor(context.state))
        }
        DynamicIslandExpandedRegion(.bottom) {
          RideActivityDetails(state: context.state)
        }
      } compactLeading: {
        Image(systemName: boardSymbol(context.state))
          .foregroundStyle(statusColor(context.state))
      } compactTrailing: {
        Text(context.state.shortCritical)
          .font(.caption2.weight(.semibold))
      } minimal: {
        Image(systemName: boardSymbol(context.state))
          .foregroundStyle(statusColor(context.state))
      }
    }
  }
}

/// Full Lock Screen / banner presentation.
private struct RideActivityLockScreenView: View {
  let state: RideActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Label(state.deviceName, systemImage: boardSymbol(state))
          .font(.subheadline.weight(.semibold))
          .lineLimit(1)
        Spacer()
        Text(state.shortCritical)
          .font(.subheadline.weight(.bold))
          .foregroundStyle(statusColor(state))
      }
      RideActivityDetails(state: state)
    }
  }
}

/// Shared details and authenticated native stop for the Lock Screen and expanded Dynamic Island.
private struct RideActivityDetails: View {
  let state: RideActivityAttributes.ContentState

  var body: some View {
    HStack(alignment: .bottom, spacing: 12) {
      RideStatusRow(state: state)
      Spacer(minLength: 8)
      Button(intent: StopRideIntent()) {
        Label("Stop ride", systemImage: "stop.fill")
          .font(.caption.weight(.semibold))
      }
      .buttonStyle(.borderedProminent)
      .tint(.red)
    }
  }
}

/// Shared status line + battery progress, used by both the Lock Screen and the expanded island.
private struct RideStatusRow: View {
  let state: RideActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(state.statusText)
        .font(.footnote)
        .foregroundStyle(state.faultCode != nil ? Color.orange : Color.secondary)
        .lineLimit(1)
      if let battery = state.batteryPercent {
        ProgressView(value: Double(battery), total: 100)
          .tint(batteryTint(battery))
      }
    }
  }
}

private func boardSymbol(_ state: RideActivityAttributes.ContentState) -> String {
  if state.faultCode != nil { return "exclamationmark.triangle.fill" }
  switch state.phase {
  case "connected": return "bolt.fill"
  case "error": return "xmark.circle.fill"
  case "idle": return "bolt.slash"
  default: return "bolt.horizontal"
  }
}

private func statusColor(_ state: RideActivityAttributes.ContentState) -> Color {
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
