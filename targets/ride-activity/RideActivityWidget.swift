import ActivityKit
import SwiftUI
import WidgetKit

@main
struct RideActivityBundle: WidgetBundle {
  var body: some Widget {
    RideActivityWidget()
  }
}

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
          VStack(alignment: .leading, spacing: 6) {
            RideNoticeRow(state: context.state, isStale: context.isStale)
            RideActivityDetails(state: context.state, isStale: context.isStale)
          }
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

private struct RideActivityLockScreenView: View {
  let state: RideActivityAttributes.ContentState
  let isStale: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label(state.deviceName, systemImage: boardSymbol(state, isStale))
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(statusColor(state, isStale))
        .lineLimit(1)
      RideNoticeRow(state: state, isStale: isStale)
      RideActivityDetails(state: state, isStale: isStale)
    }
    .opacity(isStale ? staleOpacity : 1)
  }
}

private struct RideNoticeRow: View {
  let state: RideActivityAttributes.ContentState
  let isStale: Bool

  var body: some View {
    if let title = state.noticeTitle, !isStale {
      Label(title, systemImage: noticeSymbol(state.noticeSeverity))
        .font(.footnote.weight(.semibold))
        .foregroundStyle(noticeColor(state.noticeSeverity))
        .lineLimit(1)
    }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/notification/NotificationPresenter.kt `withRideNotice`
private func noticeSymbol(_ severity: String?) -> String {
  switch severity {
  case "critical": return "exclamationmark.octagon.fill"
  case "warning": return "exclamationmark.triangle.fill"
  default: return "info.circle.fill"
  }
}

private func noticeColor(_ severity: String?) -> Color {
  switch severity {
  case "critical": return .red
  case "warning": return .orange
  default: return .blue
  }
}

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
