import CoreGraphics
import XCTest
@testable import VescapeCore

/// Heading-up placement of Group Ride marks on a 400 pt face, 600 m across (the route's own fit).
///
/// @parity /watch/wearos/src/test/java/app/vescape/wear/WatchMapProjectionTest.kt
final class WatchMapProjectionTests: XCTestCase {
  private let size = CGSize(width: 400, height: 400)
  private let margin: CGFloat = 40
  private let drop = WatchMapProjection.riderDrop
  /// Points per metre at the default span.
  private var scale: CGFloat { (400 - WatchMapProjection.edgeInset) / 600 }

  private func map(courseDeg: Double = 0, spanM: Double? = 600) -> WatchMapProjection {
    WatchMapProjection(size: size, spanM: spanM, courseDeg: courseDeg)
  }

  func testARiderAheadOnTheCourseSitsStraightAboveTheRider() {
    // Riding east; the other Rider is 100 m east.
    let placed = map(courseDeg: 90).place(eastM: 100, northM: 0, margin: margin)

    XCTAssertEqual(placed.point.x, 200, accuracy: 0.01)
    XCTAssertEqual(placed.point.y, 200 + drop - 100 * scale, accuracy: 0.01)
    XCTAssertEqual(placed.direction.dx, 0, accuracy: 1e-6)
    XCTAssertEqual(placed.direction.dy, -1, accuracy: 1e-6)
    XCTAssertTrue(placed.inRange)
  }

  func testARiderToTheNorthWhileRidingEastIsOnTheLeft() {
    let placed = map(courseDeg: 90).place(eastM: 0, northM: 100, margin: margin)

    XCTAssertEqual(placed.point.x, 200 - 100 * scale, accuracy: 0.01)
    XCTAssertEqual(placed.point.y, 200 + drop, accuracy: 0.01)
    XCTAssertTrue(placed.inRange)
  }

  func testTheRectangularDisplaysCornersAreInRange() {
    // 45° ahead-right, 150 pt out from the centre on each axis: past a 160 pt circle, inside the
    // display inset by 40 pt.
    let reach = Double(hypot(150, 150 + drop) / scale)
    let bearing = atan2(150, 150 + drop)
    let placed = map().place(eastM: reach * sin(bearing), northM: reach * cos(bearing), margin: margin)

    XCTAssertEqual(placed.point.x, 350, accuracy: 0.01)
    XCTAssertEqual(placed.point.y, 50, accuracy: 0.01)
    XCTAssertTrue(placed.inRange)
  }

  func testRangeIsMeasuredFromTheFaceCentreNotFromTheDroppedRider() {
    let aheadLimitM = Double((160 + drop) / scale)
    XCTAssertTrue(map().place(eastM: 0, northM: aheadLimitM - 1, margin: margin).inRange)
    XCTAssertFalse(map().place(eastM: 0, northM: aheadLimitM + 1, margin: margin).inRange)
    let behindLimitM = Double((160 - drop) / scale)
    XCTAssertTrue(map().place(eastM: 0, northM: -(behindLimitM - 1), margin: margin).inRange)
    XCTAssertFalse(map().place(eastM: 0, northM: -(behindLimitM + 1), margin: margin).inRange)
  }

  func testSpanFollowsThePhoneMapClampedLikeTheRoute() {
    let inset = WatchMapProjection.edgeInset
    XCTAssertEqual(
      map(spanM: 1_200).place(eastM: 0, northM: 300, margin: margin).point.y,
      200 + drop - 300 * (400 - inset) / 1_200, accuracy: 0.01
    )
    XCTAssertEqual(
      map(spanM: 10).place(eastM: 0, northM: 10, margin: margin).point.y,
      200 + drop - 10 * (400 - inset) / 150, accuracy: 0.01
    )
    XCTAssertEqual(
      map(spanM: nil).place(eastM: 0, northM: 50, margin: margin),
      map(spanM: 600).place(eastM: 0, northM: 50, margin: margin)
    )
  }

  func testRelativeBearingIsClockwiseFromTheCourse() {
    XCTAssertEqual(relativeBearingDeg(eastM: 0, northM: 10, courseDeg: 0), 0, accuracy: 1e-9)
    XCTAssertEqual(relativeBearingDeg(eastM: 0, northM: 10, courseDeg: 90), 270, accuracy: 1e-9)
    XCTAssertEqual(relativeBearingDeg(eastM: -10, northM: 0, courseDeg: 90), 180, accuracy: 1e-9)
  }

  private let sizes = WatchGroupRideMarkSizes(
    inRangeMargin: 40, edgeInset: 1, edgeCornerRadius: 0, dotRadius: 3, triangleMin: 7, triangleMax: 12
  )

  private func rider(eastM: Double, northM: Double, stale: Bool = false) -> GroupRideFrameRider {
    GroupRideFrameRider(id: "id", name: "R", colorArgb: 0xFF00FF00, eastM: eastM, northM: northM, stale: stale)
  }

  func testARiderOnTheMapIsADotAndOneBeyondItATriangleOnTheEdge() {
    let dot = map().mark(for: rider(eastM: 0, northM: 100), sizes: sizes)
    XCTAssertEqual(dot.kind, .dot)
    XCTAssertEqual(dot.size, 3)

    let far = map().mark(for: rider(eastM: 0, northM: 1_000), sizes: sizes)
    XCTAssertEqual(far.kind, .triangle)
    // Straight ahead: the top edge, one inset point in, apex pointing down.
    XCTAssertEqual(far.point.x, 200, accuracy: 0.01)
    XCTAssertEqual(far.point.y, 1, accuracy: 0.01)
    XCTAssertEqual(far.direction.dx, 0, accuracy: 1e-6)
    XCTAssertEqual(far.direction.dy, -1, accuracy: 1e-6)
  }

  func testTheEdgePointIsOnTheRayFromTheRiderNotFromTheCentre() {
    // Ahead-right at 45° from the Rider, who sits `drop` below the centre: the ray reaches the right
    // edge (x = 399) at y = 200 + drop - 199, not the corner a centre ray would hit.
    let far = map().mark(for: rider(eastM: 5_000, northM: 5_000), sizes: sizes)

    XCTAssertEqual(far.kind, .triangle)
    XCTAssertEqual(far.point.x, 399, accuracy: 0.01)
    XCTAssertEqual(far.point.y, 200 + drop - 199, accuracy: 0.01)
    XCTAssertEqual(far.direction.dx, 1, accuracy: 1e-6)
    XCTAssertEqual(far.direction.dy, 0, accuracy: 1e-6)
  }

  func testTheTriangleSitsOnTheRoundedRectangleCorner() {
    let radius: CGFloat = 80
    let rounded = WatchGroupRideMarkSizes(
      inRangeMargin: 40, edgeInset: 1, edgeCornerRadius: radius, dotRadius: 3, triangleMin: 7, triangleMax: 12
    )
    // Towards the top-right corner from the Rider.
    let far = map().mark(for: rider(eastM: 5_000, northM: 5_000 * Double(200 + drop) / 200), sizes: rounded)
    let corner = CGPoint(x: 399 - radius, y: 1 + radius)

    XCTAssertEqual(hypot(far.point.x - corner.x, far.point.y - corner.y), radius, accuracy: 0.01)
    // Square to the arc: outward points away from the corner's centre.
    XCTAssertEqual(far.direction.dx, (far.point.x - corner.x) / radius, accuracy: 1e-6)
    XCTAssertEqual(far.direction.dy, (far.point.y - corner.y) / radius, accuracy: 1e-6)
    // On the ray from the Rider.
    let ray = CGVector(dx: far.point.x - 200, dy: far.point.y - (200 + drop))
    XCTAssertEqual(ray.dx, -ray.dy * 200 / (200 + drop), accuracy: 0.01)
    // Inside the square corner a sharp rectangle would have put it on.
    XCTAssertLessThan(far.point.x, 399)
    XCTAssertGreaterThan(far.point.y, 1)
  }

  func testACloserFarRiderGetsABiggerTriangleLogScaledOutTo3Km() {
    // Ahead the map ends (160 + drop) / scale metres out.
    let boundaryM = Double((160 + drop) / scale)
    let justOut = map().mark(for: rider(eastM: 0, northM: boundaryM + 1), sizes: sizes).size
    let mid = map().mark(for: rider(eastM: 0, northM: 1_000), sizes: sizes).size

    XCTAssertEqual(justOut, 12, accuracy: 0.05)
    XCTAssertEqual(mid, 7 + 5 * CGFloat(1 - log(1_000 / boundaryM) / log(3_000 / boundaryM)), accuracy: 0.01)
    XCTAssertEqual(map().mark(for: rider(eastM: 0, northM: 3_000), sizes: sizes).size, 7)
    XCTAssertEqual(map().mark(for: rider(eastM: 0, northM: 20_000), sizes: sizes).size, 7)
  }

  func testAStaleFarRiderKeepsTheSmallestTriangle() {
    let boundaryM = Double((160 + drop) / scale)
    XCTAssertEqual(map().mark(for: rider(eastM: 0, northM: boundaryM + 1, stale: true), sizes: sizes).size, 7)
  }

  func testZoomingThePhoneMapOutBringsAFarRiderOntoTheMap() {
    let other = rider(eastM: 0, northM: 400)
    XCTAssertEqual(map(spanM: 600).mark(for: other, sizes: sizes).kind, .triangle)
    XCTAssertEqual(map(spanM: 1_200).mark(for: other, sizes: sizes).kind, .dot)
  }

  func testMarksComeFarthestFirstSoACloseRiderDrawsOnTop() {
    let marks = map().marks(
      for: [rider(eastM: 0, northM: 50), rider(eastM: 0, northM: 2_000), rider(eastM: 0, northM: 200)],
      sizes: sizes
    )
    XCTAssertEqual(marks.map(\.rider.northM), [2_000, 200, 50])
  }

  // MARK: - Nav-focus labels

  private let labelSize = CGSize(width: 30, height: 10)

  /// Places one `labelSize` label per mark and returns their origins.
  private func labels(_ marks: [WatchGroupRideMark], labelSize: CGSize? = nil, focus: Double = 1) -> [CGPoint?] {
    map().placeLabels(
      marks: marks, labels: marks.map { _ in labelSize ?? self.labelSize }, gap: 3, navFocus: focus
    )
  }

  private func label(_ mark: WatchGroupRideMark, labelSize: CGSize? = nil) -> CGPoint {
    labels([mark], labelSize: labelSize)[0]!
  }

  private func riderAt(_ id: String, eastM: Double, northM: Double) -> GroupRideFrameRider {
    GroupRideFrameRider(id: id, name: id, colorArgb: 0xFF00FF00, eastM: eastM, northM: northM, stale: false)
  }

  private func dotBounds(_ mark: WatchGroupRideMark) -> CGRect {
    CGRect(x: mark.point.x - mark.size, y: mark.point.y - mark.size, width: mark.size * 2, height: mark.size * 2)
  }

  func testADotsLabelSitsBesideItOnTheSideAwayFromTheRider() {
    let right = map().mark(for: rider(eastM: 50, northM: 100), sizes: sizes)
    XCTAssertEqual(label(right).x, right.point.x + 3 + 3, accuracy: 0.01)
    XCTAssertEqual(label(right).y, right.point.y - 5, accuracy: 0.01)

    let left = map().mark(for: rider(eastM: -50, northM: 100), sizes: sizes)
    XCTAssertEqual(label(left).x, left.point.x - 3 - 3 - 30, accuracy: 0.01)
  }

  func testADotsLabelThatWouldRunOffTheDisplayTakesTheRidersSide() {
    // 150 pt right of the centre, level with it: a 60 pt label outward would leave the display.
    let nearEdge = map().mark(for: rider(eastM: Double(150 / scale), northM: Double(drop / scale)), sizes: sizes)
    XCTAssertEqual(nearEdge.point.x, 350, accuracy: 0.01)
    XCTAssertEqual(label(nearEdge, labelSize: CGSize(width: 60, height: 10)).x, nearEdge.point.x - 3 - 3 - 60, accuracy: 0.01)
    XCTAssertEqual(label(nearEdge).x, nearEdge.point.x + 3 + 3, accuracy: 0.01)
  }

  func testATrianglesLabelSitsInwardOfItsApex() {
    // Straight ahead: triangle on the top edge, apex down; the label box centres below it.
    let far = map().mark(for: rider(eastM: 0, northM: 1_000), sizes: sizes)
    let at = label(far)
    XCTAssertEqual(at.x, 200 - 15, accuracy: 0.01)
    XCTAssertEqual(at.y, far.point.y + far.size + 3, accuracy: 0.01)
  }

  func testALabelJustOntoTheNavReadoutSlidesUpClearOfIt() {
    // At full focus the readout spans y 328–376. A dot level with the readout's top, left of the
    // Rider: its label (y 323–333) slides up to end the 3 pt gap above it.
    let onReadout = map().mark(for: rider(eastM: Double(-10 / scale), northM: Double((drop - 128) / scale)), sizes: sizes)
    XCTAssertEqual(onReadout.point.y, 328, accuracy: 0.01)
    let at = label(onReadout)
    XCTAssertEqual(at.y, 328 - 3 - 10, accuracy: 0.01)
    XCTAssertFalse(CGRect(origin: at, size: labelSize).intersects(navReadoutBounds(navFocus: 1, displaySize: size)))
  }

  func testATrianglesLabelDeepInTheNavReadoutIsDroppedNotDraggedOffItsMark() {
    // Straight behind: the triangle sits under the readout; clearing it would move the label far
    // above its apex.
    let behind = map().mark(for: rider(eastM: 0, northM: -2_000), sizes: sizes)
    XCTAssertEqual(behind.kind, .triangle)
    XCTAssertNil(labels([behind], labelSize: CGSize(width: 30, height: 20))[0])
  }

  func testTwoCloseRidersGetLabelsThatOverlapNeitherEachOtherNorTheOthersDot() {
    // 8 pt apart on the same side of the Rider: the second label would sit on the first.
    let near = map().mark(for: riderAt("near", eastM: 60, northM: 100), sizes: sizes)
    let next = map().mark(for: riderAt("next", eastM: 60, northM: 100 + Double(8 / scale)), sizes: sizes)
    let placed = labels([near, next])
    let boxA = CGRect(origin: placed[0]!, size: labelSize)
    let boxB = CGRect(origin: placed[1]!, size: labelSize)
    XCTAssertFalse(boxA.intersects(boxB))
    // The nearer Rider keeps the natural spot; the other is moved, not dropped.
    XCTAssertEqual(boxA.minY, near.point.y - 5, accuracy: 0.01)
    XCTAssertFalse(boxA.intersects(dotBounds(next)))
    XCTAssertFalse(boxB.intersects(dotBounds(near)))
  }

  func testALabelWithNoClearSpotIsDroppedRatherThanOverlap() {
    // Seven Riders on one spot: both sides and every nudge fill up before the last.
    let marks = (0..<7).map { map().mark(for: riderAt("r\($0)", eastM: 60, northM: 100), sizes: sizes) }
    let placed = labels(marks)
    XCTAssertEqual(placed[0]!.y, marks[0].point.y - 5, accuracy: 0.01)
    XCTAssertNil(placed.last!)
    let boxes = placed.compactMap { $0 }.map { CGRect(origin: $0, size: labelSize) }
    XCTAssertGreaterThanOrEqual(boxes.count, 2)
    for i in boxes.indices { for j in boxes.indices where i != j { XCTAssertFalse(boxes[i].intersects(boxes[j])) } }
  }

  func testAStaleRiderGetsNoLabelButStillKeepsOthersLabelsOffItsDot() {
    var lost = riderAt("lost", eastM: 60, northM: 100)
    lost.stale = true
    let stale = map().mark(for: lost, sizes: sizes)
    let live = map().mark(for: riderAt("live", eastM: 40, northM: 100), sizes: sizes)
    let placed = map().placeLabels(marks: [stale, live], labels: [nil, labelSize], gap: 3, navFocus: 1)
    XCTAssertNil(placed[0])
    XCTAssertFalse(CGRect(origin: placed[1]!, size: labelSize).intersects(dotBounds(stale)))
  }

  func testANudgedLabelNeverLandsOnItsOwnTriangleOrAnyOtherMark() {
    // Pairs of far Riders a few degrees apart all round the rim: the farther one's label is crowded
    // off its natural spot and nudged along the edge, back towards its own triangle.
    let boxSize = CGSize(width: 40, height: 12)
    for bearing in stride(from: 0, to: 360, by: 5) {
      for apart in [4, 8, 12] {
        for distanceM in [700.0, 1_500.0] {
          let riders = [bearing, bearing + apart].enumerated().map { i, deg in
            let rad = Double(deg) * .pi / 180
            let d = distanceM + Double(i) * 200
            return riderAt("r\(i)", eastM: d * sin(rad), northM: d * cos(rad))
          }
          let marks = map().marks(for: riders, sizes: sizes)
          let placed = map().placeLabels(marks: marks, labels: marks.map { _ in boxSize }, gap: 3, navFocus: 1)
          for (i, at) in placed.enumerated() {
            guard let at else { continue }
            let box = CGRect(origin: at, size: boxSize)
            let corners = [
              CGPoint(x: box.minX, y: box.minY), CGPoint(x: box.maxX, y: box.minY),
              CGPoint(x: box.maxX, y: box.maxY), CGPoint(x: box.minX, y: box.maxY),
            ]
            for mark in marks {
              let hit = mark.kind == .triangle
                ? polygonsOverlap(mark.triangleCorners, corners)
                : box.intersects(dotBounds(mark))
              XCTAssertFalse(hit, "label \(i) on \(mark.rider.id) at \(bearing)° +\(apart)° \(distanceM) m")
            }
          }
        }
      }
    }
  }

  /// Convex polygons overlap unless an edge normal of either separates them.
  private func polygonsOverlap(_ a: [CGPoint], _ b: [CGPoint]) -> Bool {
    [a, b].allSatisfy { poly in
      poly.indices.allSatisfy { i in
        let p = poly[i], q = poly[(i + 1) % poly.count]
        let axis = CGVector(dx: p.y - q.y, dy: q.x - p.x)
        let pa = a.map { $0.x * axis.dx + $0.y * axis.dy }
        let pb = b.map { $0.x * axis.dx + $0.y * axis.dy }
        return pa.max()! > pb.min()! + 1e-3 && pb.max()! > pa.min()! + 1e-3
      }
    }
  }
}
