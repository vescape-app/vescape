import SwiftUI

/// No fresh frames: name the reason from the watch-local link view, so a dead Bluetooth link, a
/// missing phone app and an idle one are distinguishable at a glance.
///
/// Each title names the thing that is missing rather than the state of the chain, in the rider's
/// words and not the enum's: the failure is always one broken step in watch → phone → board, and
/// the last of those is not about the phone at all.
///
/// This draws inside the rim gauges, not instead of them. The shell drops its speed and duty heroes
/// while disconnected, so the reason owns the centre of the screen rather than dodging two dashes.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/StatusLayouts.kt `DisconnectedLayout`
struct DisconnectedLayout: View {
  let link: MirrorPhoneLink
  let ambient: AmbientMode

  var body: some View {
    let (title, caption) = message

    VStack(spacing: 4) {
      Text(title)
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(ambient.readout(Palette.primaryText))
        .multilineTextAlignment(.center)
      if !caption.isEmpty {
        Text(caption)
          .font(.system(size: 12))
          .foregroundStyle(ambient.skeleton(Palette.secondaryText))
          .multilineTextAlignment(.center)
      }
    }
    .padding(.horizontal, Rim.innerInset + 8)
  }

  private var message: (String, String) {
    switch link {
    case .unknown:
      return ("Connecting…", "")
    // The title already says it. "Check Bluetooth" was the only fix a rider could try, and they try
    // it without being told.
    case .noPhone:
      return ("Phone not connected", "")
    // The companion reads as absent when the app is missing *or* too old, so the caption has to
    // cover both; naming only one of them sends half the riders down the wrong path.
    case .phoneOnly:
      return ("Phone app missing", "Install or update Vescape")
    case .appReachable:
      return ("Board not connected", "Connect it on your phone")
    }
  }
}

/// A page whose content belongs to a later slice of the watchOS port. It exists so the page
/// structure is Android's from the start — the crown and the swipes travel the same axes, in the
/// same order — rather than being re-shuffled under the rider as each channel lands.
struct PendingPage: View {
  let title: String

  var body: some View {
    VStack(spacing: 4) {
      Text(title)
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(Palette.secondaryText)
      Text("Not on the wrist yet")
        .font(.system(size: 11))
        .foregroundStyle(Palette.dimText)
    }
    .multilineTextAlignment(.center)
    .padding(.horizontal, Rim.innerInset)
  }
}
