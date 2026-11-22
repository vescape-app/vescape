import SwiftUI

/// @parity /watch/wearos/src/main/java/app/vescape/wear/StatusLayouts.kt `DisconnectedLayout`
struct DisconnectedLayout: View {
  let notice: MirrorLinkNotice
  let ambient: AmbientMode

  var body: some View {
    let (title, caption) = message

    VStack(spacing: 4) {
      Text(title)
        .font(WatchTypography.ui(size: 15, weight: .semibold))
        .foregroundStyle(ambient.readout(Palette.primaryText))
        .multilineTextAlignment(.center)
      if !caption.isEmpty {
        Text(caption)
          .font(WatchTypography.ui(size: 12))
          .foregroundStyle(ambient.skeleton(Palette.secondaryText))
          .multilineTextAlignment(.center)
      }
    }
    .padding(.horizontal, Rim.innerInset + 8)
  }

  private var message: (String, String) {
    switch notice {
    case .connecting:
      return ("Connecting…", "")
    case .noPhone:
      return ("Phone not connected", "")
    case .appMissing:
      return ("Phone app missing", "Install or update Vescape")
    }
  }
}

struct PendingPage: View {
  let title: String

  var body: some View {
    VStack(spacing: 4) {
      Text(title)
        .font(WatchTypography.ui(size: 15, weight: .semibold))
        .foregroundStyle(Palette.secondaryText)
      Text("Not on the wrist yet")
        .font(WatchTypography.ui(size: 11))
        .foregroundStyle(Palette.dimText)
    }
    .multilineTextAlignment(.center)
    .padding(.horizontal, Rim.innerInset)
  }
}
