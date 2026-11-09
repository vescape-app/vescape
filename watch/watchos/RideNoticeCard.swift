import SwiftUI

/// Full-screen Ride Notice: severity ring, title and details. A tap anywhere hides it on the wrist
/// and returns to the gauges. No actions: the phone owns every response to a notice.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/RideNoticeCard.kt `RideNoticeCard`
struct RideNoticeCard: View {
  let notice: RideNoticeFrameItem
  let ambient: AmbientMode
  let onTap: () -> Void

  var body: some View {
    let color = ambient.active ? Palette.ambientText : rideNoticeColor(notice.severity)
    VStack(spacing: 6) {
      Text(notice.title)
        .font(WatchTypography.ui(size: 18))
        .foregroundStyle(color)
        .lineLimit(2)
      if !notice.details.isEmpty {
        Text(notice.details)
          .font(WatchTypography.ui(size: 14))
          .foregroundStyle(ambient.active ? Palette.ambientText : Palette.primaryText)
          .lineLimit(4)
      }
    }
    .multilineTextAlignment(.center)
    .padding(.horizontal, 24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.black)
    .overlay(Circle().strokeBorder(color, lineWidth: ambient.active ? 1 : 4))
    .contentShape(Rectangle())
    .onTapGesture(perform: onTap)
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/RideNoticeCard.kt `rideNoticeColor`
private func rideNoticeColor(_ severity: RideNoticeFrameSeverity) -> Color {
  switch severity {
  case .critical: return Palette.critical
  case .warning: return Palette.warning
  case .info: return Palette.speed
  }
}
