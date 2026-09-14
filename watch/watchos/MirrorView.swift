import SwiftUI
import WatchConnectivity

/// The minimal wrist readout for the first slice: live Board lanes on top, the lifecycle evidence
/// the port is blocked on underneath.
///
/// Deliberately not the Wear OS layout. Rim gauges, pages, Digital Crown navigation and the rest of
/// the rectangular design follow once the runtime question below is answered — putting the finished
/// UI on top of an unproven execution model would just make a stalled mirror look healthy.
struct MirrorView: View {
  @ObservedObject var link: PhoneLink

  var body: some View {
    // A timeline rather than a timer: in the Always On state the system decides how often this
    // re-evaluates, so the age readout degrading is itself the measurement docs/watchos.md wants.
    TimelineView(.periodic(from: .now, by: 1)) { context in
      ScrollView {
        VStack(alignment: .leading, spacing: 8) {
          metrics
          Divider()
          lifecycle(now: context.date)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }

  private var metrics: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(value(link.frame?.speed, decimals: 1))
        .font(.system(size: 40, weight: .semibold, design: .rounded))
        .foregroundStyle(link.frame?.stale == false ? .primary : .secondary)
      Text("km/h").font(.caption2).foregroundStyle(.secondary)
      row("duty", value(link.frame?.duty, decimals: 0, unit: "%"))
      row("battery", value(link.frame?.battery, decimals: 0, unit: "%"))
      row("motor", value(link.frame?.motorTemp, decimals: 0, unit: "°C"))
      row("ctrl", value(link.frame?.ctrlTemp, decimals: 0, unit: "°C"))
    }
  }

  /// The instrumentation panel. Frame age is the one that answers the wrist-down question: if the
  /// app stops executing while lowered, this climbs and the numbers above it freeze at a value that
  /// still looks plausible.
  private func lifecycle(now: Date) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      row("session", activationLabel)
      row("phone", link.reachable ? "reachable" : "unreachable")
      row("companion", link.companionInstalled ? "installed" : "absent")
      row("age", link.lastFrameAt.map { String(format: "%.1fs", now.timeIntervalSince($0)) } ?? "—")
      row("rx", String(format: "%.1f Hz", link.receivedHz))
      row("drawn", String(format: "%.1f Hz", link.appliedHz))
      if link.rejected > 0 {
        // Not a transient: a lane-count mismatch means the phone and the wrist were built from
        // different commits and every frame will keep being rejected until one is reinstalled.
        row("rejected", "\(link.rejected)")
      }
    }
    .font(.caption2)
  }

  private var activationLabel: String {
    switch link.activation {
    case .activated: return "activated"
    case .inactive: return "inactive"
    case .notActivated: return "not activated"
    @unknown default: return "unknown"
    }
  }

  private func row(_ label: String, _ value: String) -> some View {
    HStack {
      Text(label).foregroundStyle(.secondary)
      Spacer(minLength: 4)
      Text(value).monospacedDigit()
    }
  }

  /// An empty lane reads as "—", never as zero: a board that is not connected and a board sitting
  /// still are different things, and the wrist must not blur them.
  private func value(_ lane: Double?, decimals: Int, unit: String = "") -> String {
    guard let lane else { return "—" }
    return String(format: "%.\(decimals)f%@", lane, unit)
  }
}
