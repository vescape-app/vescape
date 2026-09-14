import SwiftUI
import WatchConnectivity

/// The minimal wrist readout for the first slice: live Board lanes on top, the lifecycle evidence
/// the port is blocked on underneath.
///
/// Deliberately not the Wear OS layout. Rim gauges, pages, Digital Crown navigation and the rest of
/// the rectangular design follow once the runtime question below is answered — putting the finished
/// UI on top of an unproven execution model would just make a stalled mirror look healthy.
///
/// Dense on purpose: the instrumentation has to be readable without scrolling on the smallest
/// supported watch, because the thing being measured is what the screen does when nobody is
/// touching it.
struct MirrorView: View {
  @ObservedObject var link: PhoneLink

  private let columns = [GridItem(.flexible()), GridItem(.flexible())]

  var body: some View {
    // A timeline rather than a timer: in the Always On state the system decides how often this
    // re-evaluates, so the age readout degrading is itself the measurement docs/watchos.md wants.
    TimelineView(.periodic(from: .now, by: 1)) { context in
      ScrollView {
        VStack(alignment: .leading, spacing: 6) {
          speed
          LazyVGrid(columns: columns, alignment: .leading, spacing: 2) {
            cell("duty", value(link.frame?.duty, decimals: 0, unit: "%"))
            cell("batt", value(link.frame?.battery, decimals: 0, unit: "%"))
            cell("motor", value(link.frame?.motorTemp, decimals: 0, unit: "°"))
            cell("ctrl", value(link.frame?.ctrlTemp, decimals: 0, unit: "°"))
          }
          Divider()
          lifecycle(now: context.date)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }

  private var speed: some View {
    HStack(alignment: .firstTextBaseline, spacing: 3) {
      // The placeholder is not just a small number: an em dash set at display size reads as a
      // progress bar, which is exactly the wrong thing for "no board connected" to look like.
      Text(link.frame?.speed.map { String(format: "%.1f", $0) } ?? "—")
        .font(
          link.frame?.speed == nil
            ? .title3
            : .system(size: 34, weight: .semibold, design: .rounded)
        )
        .foregroundStyle(link.frame?.stale == false ? .primary : .secondary)
      Text("km/h").font(.caption2).foregroundStyle(.secondary)
    }
  }

  /// The instrumentation panel. Frame age is the one that answers the wrist-down question: if the
  /// app stops executing while lowered, this climbs and the numbers above it freeze at a value that
  /// still looks plausible.
  private func lifecycle(now: Date) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      cell("link", statusLabel)
      cell("age", link.lastFrameAt.map { String(format: "%.1fs", now.timeIntervalSince($0)) } ?? "—")
      cell("rx", String(format: "%.1f / %.1f Hz", link.receivedHz, link.appliedHz))
      if link.rejected > 0 {
        // Not a transient: a lane-count mismatch means the phone and the wrist were built from
        // different commits and every frame will keep being rejected until one is reinstalled.
        cell("rejected", "\(link.rejected)")
      }
    }
  }

  /// One line for the whole counterpart state. The failures are ordered — an unactivated session
  /// says nothing about reachability — so the first unmet condition is the only useful one to show.
  private var statusLabel: String {
    switch link.activation {
    case .activated: break
    case .inactive: return "inactive"
    case .notActivated: return "not activated"
    @unknown default: return "unknown"
    }
    if !link.companionInstalled { return "no phone app" }
    return link.reachable ? "reachable" : "unreachable"
  }

  private func cell(_ label: String, _ value: String) -> some View {
    HStack(spacing: 3) {
      Text(label).foregroundStyle(.secondary)
      Spacer(minLength: 2)
      Text(value).monospacedDigit()
    }
    .font(.caption2)
  }

  /// An empty lane reads as "—", never as zero: a board that is not connected and a board sitting
  /// still are different things, and the wrist must not blur them.
  private func value(_ lane: Double?, decimals: Int, unit: String = "") -> String {
    guard let lane else { return "—" }
    return String(format: "%.\(decimals)f%@", lane, unit)
  }
}
