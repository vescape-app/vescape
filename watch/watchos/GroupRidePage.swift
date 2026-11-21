import SwiftUI

/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRidePage.kt `GroupRidePage`
/// @platform-diff Wear OS has no crown binding on its pager, so its settled list owns the crown even
struct GroupRidePage: View {
  let group: WatchGroupRide
  let settled: Bool
  var distanceUnit: String = "km"
  var onPageBack: () -> Void = {}

  @State private var crown = 0.0
  @State private var travel: CGFloat = 0
  @State private var dragBase: CGFloat?
  @FocusState private var crownFocused: Bool

  var body: some View {
    let rows = group.roster()
    let maxFirst = max(rows.count - GROUP_PAGE_ROWS, 0)
    let maxTravel = CGFloat(maxFirst) * GROUP_ROW_HEIGHT
    let shown = dragBase == nil ? min(max(travel, 0), maxTravel) : travel
    let scrolls = maxFirst > 0
    let bodyHeight = GROUP_ROW_HEIGHT * CGFloat(max(min(rows.count, GROUP_PAGE_ROWS), 1))

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
        } else {
          VStack(spacing: 0) {
            ForEach(rows, id: \.rider.id) { row in
              GroupRideRowView(row: row, distanceUnit: distanceUnit)
                .frame(width: width, height: GROUP_ROW_HEIGHT)
            }
          }
          .offset(y: -shown)
          .frame(height: bodyHeight, alignment: .top)
          .clipped()
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .overlay(alignment: .trailing) {
        if scrolls {
          GroupWindowIndicator(first: min(max(shown / GROUP_ROW_HEIGHT, 0), CGFloat(maxFirst)), maxFirst: maxFirst, total: rows.count)
            .padding(.trailing, GROUP_INDICATOR_INSET)
            .offset(y: GROUP_INDICATOR_DROP)
        }
      }
    }
    .contentShape(Rectangle())
    .gesture(listDrag(maxFirst: maxFirst, maxTravel: maxTravel), including: settled && scrolls ? .all : .subviews)
    .focusable(settled && scrolls)
    .focused($crownFocused)
    .digitalCrownRotation(
      $crown,
      from: 0,
      through: Double(max(maxFirst, 1)),
      by: 1,
      sensitivity: .low,
      isContinuous: false,
      isHapticFeedbackEnabled: true
    )
    .onChange(of: crown) { _, row in
      let target = CGFloat(row.rounded()) * GROUP_ROW_HEIGHT
      guard dragBase == nil, abs(target - travel) > 0.5 else { return }
      withAnimation(.easeOut(duration: GROUP_STEP_SECONDS)) { travel = target }
    }
    .onChange(of: settled && scrolls, initial: true) { _, owns in crownFocused = owns }
  }

  private func listDrag(maxFirst: Int, maxTravel: CGFloat) -> some Gesture {
    DragGesture()
      .onChanged { value in
        let base = dragBase ?? min(max(travel, 0), maxTravel)
        if dragBase == nil { dragBase = base }
        let raw = base - value.translation.height
        travel = raw < 0 ? raw * GROUP_OVERSCROLL : raw > maxTravel ? maxTravel + (raw - maxTravel) * GROUP_OVERSCROLL : raw
      }
      .onEnded { value in
        let base = dragBase ?? travel
        dragBase = nil
        let pull = value.translation.height
        if base < 0.5, pull >= GROUP_PAGE_BACK_PULL, pull > abs(value.translation.width) {
          withAnimation(.easeOut(duration: GROUP_STEP_SECONDS)) { travel = 0 }
          onPageBack()
          return
        }
        let projected = (base - value.predictedEndTranslation.height) / GROUP_ROW_HEIGHT
        let row = min(max(Int(projected.rounded()), 0), maxFirst)
        withAnimation(.spring(response: GROUP_SETTLE_SECONDS, dampingFraction: 1)) {
          travel = CGFloat(row) * GROUP_ROW_HEIGHT
        }
        crown = Double(row)
      }
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRidePage.kt `GroupWindowIndicatorState`
/// @platform-diff Drawn here; Wear OS drives its library `PositionIndicator` with the same window.
private struct GroupWindowIndicator: View {
  let first: CGFloat
  let maxFirst: Int
  let total: Int

  var body: some View {
    let thumb = GROUP_INDICATOR_LENGTH * CGFloat(GROUP_PAGE_ROWS) / CGFloat(max(total, GROUP_PAGE_ROWS))
    let travel = (GROUP_INDICATOR_LENGTH - thumb) * first / CGFloat(max(maxFirst, 1))
    ZStack(alignment: .top) {
      Capsule().fill(Palette.guide)
      Capsule()
        .fill(Palette.secondaryText)
        .frame(height: thumb)
        .offset(y: travel)
    }
    .frame(width: GROUP_INDICATOR_WIDTH, height: GROUP_INDICATOR_LENGTH)
  }
}

private struct GroupRideRowView: View {
  let row: WatchGroupRideRow
  let distanceUnit: String

  var body: some View {
    HStack(spacing: 0) {
      Circle()
        .fill(Color(argb: row.rider.colorArgb))
        .frame(width: GROUP_ROW_DOT, height: GROUP_ROW_DOT)
      Text(row.name)
        .font(WatchTypography.ui(size: GROUP_NAME_FONT_SIZE))
        .foregroundStyle(Palette.primaryText)
        .lineLimit(1)
        .minimumScaleFactor(GROUP_NAME_MIN_SCALE)
        .padding(.leading, 3)
        .padding(.trailing, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
      BearingArrow()
        .fill(Palette.secondaryText)
        .frame(width: GROUP_ARROW_BOX, height: GROUP_ARROW_BOX)
        .rotationEffect(.degrees(row.bearingDeg))
      Text(groupRideDistanceLabel(row.rider.distanceM, distanceUnit: distanceUnit))
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

/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRidePage.kt `GROUP_PAGE_ROWS`
private let GROUP_PAGE_ROWS = 5

/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRidePage.kt `GROUP_INDICATOR_LENGTH`
private let GROUP_INDICATOR_LENGTH: CGFloat = 40
private let GROUP_INDICATOR_WIDTH: CGFloat = 3
private let GROUP_INDICATOR_INSET: CGFloat = (Rim.innerInset + RimStyle.strong.valueWidth - GROUP_INDICATOR_WIDTH) / 2
private let GROUP_INDICATOR_DROP: CGFloat = GROUP_INDICATOR_LENGTH / 2 + 6

/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRidePage.kt `GROUP_STEP_MS`
private let GROUP_STEP_SECONDS = 0.15
private let GROUP_SETTLE_SECONDS = 0.3
private let GROUP_OVERSCROLL: CGFloat = 0.35
private let GROUP_PAGE_BACK_PULL: CGFloat = 24
private let GROUP_ROW_HEIGHT: CGFloat = 22
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRidePage.kt `GROUP_ROW_W`
private let GROUP_ROW_WIDTH: CGFloat = 150
private let GROUP_TITLE_HEIGHT: CGFloat = 14
private let GROUP_TITLE_GAP: CGFloat = 4
private let GROUP_TITLE_FONT_SIZE: CGFloat = 11
private let GROUP_NAME_FONT_SIZE: CGFloat = 13
private let GROUP_VALUE_FONT_SIZE: CGFloat = 11
private let GROUP_ROW_DOT: CGFloat = 6
private let GROUP_ARROW_BOX: CGFloat = 10
private let GROUP_DISTANCE_WIDTH: CGFloat = 40
private let GROUP_STATUS_WIDTH: CGFloat = 27
private let GROUP_VALUE_GAP: CGFloat = 5
private let GROUP_THERMOMETER_WIDTH: CGFloat = 7
private let GROUP_THERMOMETER_HEIGHT: CGFloat = 15
private let GROUP_NAME_MIN_SCALE: CGFloat = 0.7
private let GROUP_STALE_ROW_OPACITY = 0.4
