import SwiftUI

/// The Group Ride page, one page below navigation, present only while the Rider is joined: every
/// other Rider nearest first, one row each — colour dot, name, an arrow to where they are relative
/// to the Rider's course, distance, and one status slot (`groupRideStatus`). Alone, it says so.
///
/// Up to `GROUP_PAGE_ROWS` rows, centred. Past that the Digital Crown steps the window a row at a
/// time — but only while this page is the settled page (`crownActive`), so the crown pages the
/// vertical axis everywhere else and the two never compete for it. Swipes keep paging from here. The
/// nav map and readout are hidden under this page by the caller; ambient parks the axis on the
/// gauges, so this is never drawn there.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRidePage.kt `GroupRidePage`
/// @platform-diff Wear OS has no crown binding on its pager, so its settled list owns the crown even
///   when it fits. Row width is clamped to the display less the rim inset rather than a round
///   face's chord. Only watchOS shrinks an over-wide name or distance; Compose here cannot.
struct GroupRidePage: View {
  let group: WatchGroupRide
  /// This page is the settled vertical page: the crown may leave the pager for the list.
  let crownActive: Bool
  var unitSystem: String = "metric"

  @State private var crown = 0.0
  @FocusState private var crownFocused: Bool

  var body: some View {
    let rows = group.roster()
    let maxFirst = max(rows.count - GROUP_PAGE_ROWS, 0)
    // A Rider leaving can shorten the list under the window.
    let first = min(max(Int(crown.rounded()), 0), maxFirst)
    let visible = rows[first..<min(rows.count, first + GROUP_PAGE_ROWS)]
    let scrolls = maxFirst > 0

    GeometryReader { geometry in
      let width = min(GROUP_ROW_WIDTH, geometry.size.width - 2 * Rim.innerInset)
      VStack(spacing: 0) {
        Text("Group · \(rows.count)")
          .font(WatchTypography.ui(size: GROUP_TITLE_FONT_SIZE))
          .foregroundStyle(Palette.secondaryText)
          .frame(height: GROUP_TITLE_HEIGHT)
          .padding(.bottom, GROUP_TITLE_GAP)
        if rows.isEmpty {
          Text("Waiting for riders")
            .font(WatchTypography.ui(size: GROUP_NAME_FONT_SIZE))
            .foregroundStyle(Palette.dimText)
            .frame(height: GROUP_ROW_HEIGHT)
        }
        ForEach(visible, id: \.rider.id) { row in
          GroupRideRowView(row: row, unitSystem: unitSystem)
            .frame(width: width, height: GROUP_ROW_HEIGHT)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .focusable(crownActive && scrolls)
    .focused($crownFocused)
    .digitalCrownRotation(
      $crown,
      from: 0,
      // Never an empty span: the binding stays mounted while the list fits and takes no input.
      through: Double(max(maxFirst, 1)),
      by: 1,
      sensitivity: .low,
      isContinuous: false,
      isHapticFeedbackEnabled: true
    )
    // Take the crown on arrival and hand it back on the way out, so the pager keeps it everywhere
    // else — including the swipe back up from here.
    .onChange(of: crownActive && scrolls, initial: true) { _, owns in crownFocused = owns }
  }
}

private struct GroupRideRowView: View {
  let row: WatchGroupRideRow
  let unitSystem: String

  var body: some View {
    HStack(spacing: 0) {
      Circle()
        .fill(Color(argb: row.rider.colorArgb))
        .frame(width: GROUP_ROW_DOT, height: GROUP_ROW_DOT)
      Text(row.name)
        .font(WatchTypography.ui(size: GROUP_NAME_FONT_SIZE))
        .foregroundStyle(Palette.primaryText)
        .lineLimit(1)
        // A five-character name fits the 40 mm row at full size; only the widest glyphs shrink.
        .minimumScaleFactor(GROUP_NAME_MIN_SCALE)
        .padding(.leading, 3)
        .padding(.trailing, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
      BearingArrow()
        .fill(Palette.secondaryText)
        .frame(width: GROUP_ARROW_BOX, height: GROUP_ARROW_BOX)
        .rotationEffect(.degrees(row.bearingDeg))
      Text(groupRideDistanceLabel(row.rider.distanceM, unitSystem: unitSystem))
        .font(WatchTypography.mono(size: GROUP_VALUE_FONT_SIZE))
        .foregroundStyle(Palette.primaryText)
        .lineLimit(1)
        .minimumScaleFactor(GROUP_NAME_MIN_SCALE)
        .frame(width: GROUP_DISTANCE_WIDTH, alignment: .trailing)
      Spacer().frame(width: GROUP_VALUE_GAP)
      statusSlot
        .frame(width: GROUP_STATUS_WIDTH, alignment: .trailing)
    }
    .opacity(row.status == .stale ? GROUP_STALE_ROW_OPACITY : 1)
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRidePage.kt `StatusSlot`
  @ViewBuilder
  private var statusSlot: some View {
    let font = WatchTypography.mono(size: GROUP_VALUE_FONT_SIZE)
    switch row.status {
    case .stale:
      Text("lost").font(font).foregroundStyle(Palette.dimText)
    case .noBoard:
      Text(WatchGauge.dash).font(font).foregroundStyle(Palette.dimText)
    case let .hot(level):
      let color = Palette.level(level) ?? Palette.secondaryText
      Canvas { context, size in
        context.drawThermometer(in: CGRect(origin: .zero, size: size), color: color)
      }
      .frame(width: GROUP_THERMOMETER_WIDTH, height: GROUP_THERMOMETER_HEIGHT)
    case let .battery(percent, level):
      Text("\(percent)%").font(font).foregroundStyle(Palette.level(level) ?? Palette.secondaryText)
    }
  }
}

/// Filled arrow pointing up (straight ahead) before rotation, centred in its box.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRidePage.kt `drawBearingArrow`
private struct BearingArrow: Shape {
  func path(in rect: CGRect) -> Path {
    let c = CGPoint(x: rect.midX, y: rect.midY)
    let h = min(rect.width, rect.height) * 0.42
    let w = min(rect.width, rect.height) * 0.30
    var path = Path()
    path.move(to: CGPoint(x: c.x, y: c.y - h))
    path.addLine(to: CGPoint(x: c.x + w, y: c.y + h))
    path.addLine(to: CGPoint(x: c.x, y: c.y + h * 0.45))
    path.addLine(to: CGPoint(x: c.x - w, y: c.y + h))
    path.closeSubpath()
    return path
  }
}

/// Rows on screen before the crown scrolls the list.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRidePage.kt `GROUP_PAGE_ROWS`
private let GROUP_PAGE_ROWS = 5
private let GROUP_ROW_HEIGHT: CGFloat = 22
/// On the 40 mm display the row is 138 pt (the display less the rim inset): 93 pt of fixed columns
/// leaves 45 pt, a five-character name ("Tomek" is 42.5 pt) at full size.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRidePage.kt `GROUP_ROW_W`
private let GROUP_ROW_WIDTH: CGFloat = 150
private let GROUP_TITLE_HEIGHT: CGFloat = 14
private let GROUP_TITLE_GAP: CGFloat = 4
private let GROUP_TITLE_FONT_SIZE: CGFloat = 11
private let GROUP_NAME_FONT_SIZE: CGFloat = 13
private let GROUP_VALUE_FONT_SIZE: CGFloat = 11
private let GROUP_ROW_DOT: CGFloat = 6
private let GROUP_ARROW_BOX: CGFloat = 10
/// Six mono characters ("12.3km") at the value size; "100%" or "lost" in the status slot.
private let GROUP_DISTANCE_WIDTH: CGFloat = 40
private let GROUP_STATUS_WIDTH: CGFloat = 27
/// Between the distance and the status slot, so "49m" and "lost" never run together.
private let GROUP_VALUE_GAP: CGFloat = 5
private let GROUP_THERMOMETER_WIDTH: CGFloat = 7
private let GROUP_THERMOMETER_HEIGHT: CGFloat = 15
/// The widest five-character names and seven-character distances shrink this far rather than cut.
private let GROUP_NAME_MIN_SCALE: CGFloat = 0.7
/// A lost Rider's row: there, but plainly not current.
private let GROUP_STALE_ROW_OPACITY = 0.4
