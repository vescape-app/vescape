import XCTest
@testable import VescapeCore

/// @parity /watch/wearos/src/test/java/app/vescape/wear/WatchMirrorIntakeTest.kt
final class WatchMirrorIntakeTests: XCTestCase {
  private let route = WatchRoute(points: [WatchRoutePoint(eastM: 0, northM: 0), WatchRoutePoint(eastM: 123, northM: -456)])
  private let frame = WatchFrame(
    speed: 21, duty: 40, battery: 80, motorTemp: 30, ctrlTemp: 25,
    navBearing: 30, navDistanceM: 150, riderEastM: 12, riderNorthM: 20, courseDeg: 90,
    trail: [WatchTrailPoint(eastM: -12, northM: -20), WatchTrailPoint(eastM: 0, northM: 0)],
    mapPosition: WatchMapPosition(latitude: 50, longitude: 20)
  )

  func testNavigationClearKeepsIndependentGPSAndTrailUntilTheirOwnReplacement() throws {
    var intake = WatchMirrorIntake()
    let bytes = try XCTUnwrap(WatchMirrorReplayAdapter.route(route))
    intake.restoreColdState([
      watchRouteChannel: [WatchRouteKey.version: WATCH_ROUTE_VERSION, WatchRouteKey.points: bytes],
      watchSettingsChannel: [WatchSettingsKey.telemetryTrailEnabled: false],
    ])
    intake.acceptTelemetry(WatchMirrorReplayAdapter.telemetry(frame), receivedAtMs: 1_000, appliedAtMs: 1_000)
    intake.acceptRouteStatus(WatchRouteStatusCodec.encode(WatchRouteStatus(phase: .ready, routeId: WatchRouteStatusCodec.routeId(bytes))))
    XCTAssertTrue(try XCTUnwrap(intake.routeStatus).canDraw(receivedRouteId: intake.route?.routeId))
    XCTAssertFalse(intake.settings.telemetryTrailEnabled)
    XCTAssertEqual(intake.mirror.frame?.mapPosition, frame.mapPosition)
    XCTAssertEqual(intake.mirror.frame?.trail, frame.trail)

    intake.acceptRoute(nil)
    intake.acceptRouteStatus(WatchRouteStatusCodec.encode(WatchRouteStatus(phase: .idle)))
    var withoutNavigation = frame
    withoutNavigation.navBearing = nil
    withoutNavigation.navDistanceM = nil
    withoutNavigation.riderEastM = nil
    withoutNavigation.riderNorthM = nil
    intake.acceptTelemetry(WatchMirrorReplayAdapter.telemetry(withoutNavigation), receivedAtMs: 1_250, appliedAtMs: 1_250)
    XCTAssertNil(intake.route)
    XCTAssertNil(intake.mirror.frame?.navBearing)
    XCTAssertEqual(intake.mirror.frame?.trail, frame.trail)
    XCTAssertEqual(intake.mirror.frame?.mapPosition, frame.mapPosition)

    withoutNavigation.mapPosition = nil
    withoutNavigation.trail = []
    intake.acceptTelemetry(WatchMirrorReplayAdapter.telemetry(withoutNavigation), receivedAtMs: 1_500, appliedAtMs: 1_500)
    XCTAssertNil(intake.mirror.frame?.mapPosition)
    XCTAssertEqual(intake.mirror.frame?.trail, [])
  }

  func testArrivalClockExpiresQueuedFramesAndMalformedFramesNeverRenewFreshness() {
    var intake = WatchMirrorIntake()
    XCTAssertTrue(intake.acceptTelemetry(WatchMirrorReplayAdapter.telemetry(frame), receivedAtMs: 1_000, appliedAtMs: 2_000))
    XCTAssertEqual(intake.mirror.status, .disconnected)
    XCTAssertEqual(intake.lastFrameAtMs, 1_000)
    intake.acceptTelemetry(WatchMirrorReplayAdapter.telemetry(frame), receivedAtMs: 2_250, appliedAtMs: 2_250)
    XCTAssertEqual(intake.mirror.status, .live)
    XCTAssertFalse(intake.acceptTelemetry(Data([1]), receivedAtMs: 5_000, appliedAtMs: 5_000))
    XCTAssertEqual(intake.lastFrameAtMs, 2_250)
    intake.refresh(nowMs: 6_001)
    XCTAssertEqual(intake.mirror.status, .disconnected)
    intake.acceptTelemetry(WatchMirrorReplayAdapter.telemetry(frame), receivedAtMs: 6_250, appliedAtMs: 6_250)
    XCTAssertEqual(intake.mirror.status, .live)
  }

  func testDisconnectClearsHotStatusAndGroupButPreservesColdChannels() {
    var intake = WatchMirrorIntake()
    intake.acceptRoute(WatchMirrorReplayAdapter.route(route))
    intake.acceptSettings([WatchSettingsKey.unitSystem: "imperial"])
    intake.acceptTelemetry(WatchMirrorReplayAdapter.telemetry(frame), receivedAtMs: 1_000, appliedAtMs: 1_000)
    intake.acceptRouteStatus(WatchRouteStatusCodec.encode(WatchRouteStatus(phase: .computing)))
    intake.acceptGroupRide(GroupRideFrameCodec.encode(GroupRideFrame(courseDeg: 90, spanM: 600, riders: [])), receivedAtMs: 1_000)
    intake.acceptGroupRide(GroupRideFrameCodec.encode(GroupRideFrame(courseDeg: nil, spanM: 600, riders: [])), receivedAtMs: 2_000)
    XCTAssertEqual(intake.groupRide?.courseDeg, 90)
    intake.acceptGroupRide(Data([99]), receivedAtMs: 5_000)
    intake.acceptRouteStatus(Data([99]))
    intake.refresh(nowMs: 5_501)
    XCTAssertNil(intake.groupRide)
    XCTAssertNil(intake.routeStatus)
    XCTAssertNotNil(intake.route)
    XCTAssertEqual(intake.settings.unitSystem, "imperial")
    intake.acceptTelemetry(WatchMirrorReplayAdapter.telemetry(frame), receivedAtMs: 6_000, appliedAtMs: 6_000)
    intake.acceptGroupRide(GroupRideFrameCodec.encode(GroupRideFrame(courseDeg: nil, spanM: 600, riders: [])), receivedAtMs: 6_000)
    XCTAssertEqual(intake.groupRide?.courseDeg, 0)
    XCTAssertEqual(intake.mirror.status, .live)
  }

  func testIncrementalDeletionAndEmptyReconnectSnapshotHaveDifferentScopes() throws {
    var intake = WatchMirrorIntake()
    let bytes = try XCTUnwrap(WatchMirrorReplayAdapter.route(route))
    let weather: [String: Any] = ["temperatureC": 17, "icon": "clear", "fetchedAtMs": Int64(1_000)]
    intake.restoreColdState([
      watchRouteChannel: [WatchRouteKey.version: WATCH_ROUTE_VERSION, WatchRouteKey.points: bytes],
      watchSettingsChannel: [WatchSettingsKey.telemetryTrailEnabled: false],
      watchWeatherChannel: weather,
      watchBoardChannel: ["lightsEnabled": true, "lightsControllable": true],
    ])
    var updatedWeather = weather
    updatedWeather["fetchedAtMs"] = Int64(2_000)
    intake.acceptWeather(updatedWeather)
    XCTAssertEqual(intake.weather?.fetchedAtMs, 2_000)
    intake.acceptSettings(nil)
    XCTAssertTrue(intake.settings.telemetryTrailEnabled)
    XCTAssertNotNil(intake.route)
    XCTAssertTrue(intake.board.lightsControllable)
    intake.restoreColdState([:])
    XCTAssertNil(intake.route)
    XCTAssertNil(intake.weather)
    XCTAssertNil(intake.board.lightsEnabled)
    XCTAssertFalse(intake.board.lightsControllable)
    XCTAssertTrue(intake.settings.telemetryTrailEnabled)
  }

  func testReplayRoutePreservesGeometryAndUsesTheWireFingerprint() throws {
    var intake = WatchMirrorIntake()
    let bytes = try XCTUnwrap(WatchMirrorReplayAdapter.route(route))
    intake.acceptRoute(bytes)
    let decoded = try XCTUnwrap(intake.route)
    XCTAssertEqual(decoded.routeId, WatchRouteStatusCodec.routeId(bytes))
    XCTAssertEqual(decoded.points[1].eastM, 123, accuracy: 0.12)
    XCTAssertEqual(decoded.points[1].northM, -456, accuracy: 0.12)
    XCTAssertNil(WatchMirrorReplayAdapter.route(WatchRoute(points: [WatchRoutePoint(eastM: 1, northM: 2)])))
    intake.acceptRoute(Data([99]))
    XCTAssertNil(intake.route)
  }
}
