import XCTest
@testable import VescapeCore

/// The radar provider contract the wrist fetches against: which frames it takes, what a frame URL
/// looks like, how far the imagery reaches on the ground, and when what it holds stops describing
/// where the rider is.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRadar.kt
final class WatchRadarTests: XCTestCase {
  private let meta = """
    {
      "host": "https://tilecache.rainviewer.com",
      "radar": {
        "past": [
          { "time": 1700000000, "path": "/v2/radar/1700000000" },
          { "time": 1700000600, "path": "/v2/radar/1700000600" }
        ],
        "nowcast": [{ "time": 1700001200, "path": "/v2/radar/nowcast_1700001200" }]
      }
    }
    """

  func testTakesObservedFramesAndNotTheNowcast() {
    // A nowcast frame is a forecast, not an observation; replaying it as radar would show a rider
    // rain that has not happened.
    let parsed = RainViewer.parseMeta(Data(meta.utf8))
    XCTAssertEqual(parsed?.host, "https://tilecache.rainviewer.com")
    XCTAssertEqual(parsed?.frames.map(\.timeSec), [1_700_000_000, 1_700_000_600])
  }

  func testAMalformedResponseIsNoRadarRatherThanAnEmptyOne() {
    XCTAssertNil(RainViewer.parseMeta(Data("not json".utf8)))
    XCTAssertNil(RainViewer.parseMeta(Data("{\"radar\":{}}".utf8)))
  }

  func testFrameUrlCarriesTheRidersCentreAndTheSharedRendering() {
    let url = RainViewer.frameURL(
      host: "https://tilecache.rainviewer.com",
      frame: RadarFrame(timeSec: 1, path: "/v2/radar/1"),
      latitude: 52.23,
      longitude: 21.01
    )
    XCTAssertEqual(url, "https://tilecache.rainviewer.com/v2/radar/1/256/6/52.23/21.01/2/1_1.png")
  }

  func testGroundRangeShrinksAwayFromTheEquator() {
    // Web-Mercator: the same image covers less ground in Oslo than in Madrid, which is what the
    // range rings have to follow rather than assuming one scale.
    let equator = radarFaceRangeM(latitude: 0)
    let oslo = radarFaceRangeM(latitude: 59.9)
    XCTAssertEqual(equator, 156_543.03392 / 64 * 128, accuracy: 0.001)
    XCTAssertLessThan(oslo, equator)
  }

  func testJitterInPlaceDoesNotThrowTheAnimationAway() {
    let centre = radarRoundedCentre(latitude: 52.2300, longitude: 21.0100)
    XCTAssertFalse(
      radarIsStale(
        centre: centre, fetchedAtMs: 0, nowMs: radarRefreshMs,
        latitude: 52.23004, longitude: 21.01002
      )
    )
  }

  func testRealMovementAndRealAgeBothRefetch() {
    let centre = radarRoundedCentre(latitude: 52.23, longitude: 21.01)
    XCTAssertTrue(
      radarIsStale(
        centre: centre, fetchedAtMs: 0, nowMs: radarRefreshMs + 1,
        latitude: 52.23, longitude: 21.01
      )
    )
    XCTAssertTrue(
      radarIsStale(
        centre: centre, fetchedAtMs: 0, nowMs: 0, latitude: 52.30, longitude: 21.01
      )
    )
  }

  func testNothingLoadedYetIsAlwaysStale() {
    XCTAssertTrue(
      radarIsStale(centre: nil, fetchedAtMs: 0, nowMs: 0, latitude: 52.23, longitude: 21.01)
    )
  }
}
