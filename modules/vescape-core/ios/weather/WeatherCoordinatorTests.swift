import XCTest
@testable import VescapeCore

private func forecastBody(_ temperatureC: Int) -> Data {
  Data(#"{"current":{"time":"2026-06-10T12:00","temperature_2m":\#(temperatureC).0,"weather_code":3}}"#.utf8)
}

/// Forecast lifecycle: the freshness and distance gate, coalescing of in-flight requests without
/// losing the ride's newest position, and retention of a successful result across later failures.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/weather/WeatherCoordinatorTest.kt
final class WeatherCoordinatorTests: XCTestCase {
  /// Records every request and hands each one's completion back for manual resolution.
  private final class RecordingTransport {
    var urls: [String] = []
    private var pending: [(Data?) -> Void] = []

    var inFlight: Int { pending.count }

    lazy var transport: WeatherTransport = { [unowned self] url, onResult in
      self.urls.append(url)
      self.pending.append(onResult)
    }

    func resolveLast(_ body: Data?) {
      pending.removeLast()(body)
    }
  }

  private var now: Int64 = 1_000
  private var transport = RecordingTransport()
  private var coordinator: WeatherCoordinator!

  override func setUp() {
    super.setUp()
    now = 1_000
    transport = RecordingTransport()
    coordinator = WeatherCoordinator(transport: transport.transport, nowMs: { [unowned self] in now })
  }

  func testHoldsAFreshForecastRatherThanRefetchingPerGpsFix() {
    coordinator.onPosition(latitude: 52.2000, longitude: 21.0000)
    transport.resolveLast(forecastBody(20))

    // A metre down the road, seconds later: same grid cell, same ten-minute window.
    coordinator.onPosition(latitude: 52.2001, longitude: 21.0001)
    now += 60_000

    XCTAssertEqual(transport.urls.count, 1)
    XCTAssertEqual(coordinator.current?.temperatureC, 20)
  }

  func testRefetchesOnceTheRiderLeavesTheAreaTheForecastDescribes() {
    coordinator.onPosition(latitude: 52.2, longitude: 21.0)
    transport.resolveLast(forecastBody(20))

    coordinator.onPosition(latitude: 52.4, longitude: 21.0)

    XCTAssertEqual(transport.urls.count, 2)
    XCTAssertTrue(transport.urls.last?.contains("latitude=52.4") == true)
  }

  func testRefetchesOnceTheForecastAgesOutWhereTheRiderIsStanding() {
    coordinator.onPosition(latitude: 52.2, longitude: 21.0)
    transport.resolveLast(forecastBody(20))

    now += WeatherCoordinator.forecastTtlMs
    coordinator.onPosition(latitude: 52.2, longitude: 21.0)

    XCTAssertEqual(transport.urls.count, 2)
  }

  func testFollowsTheRideToThePositionThatArrivedMidFetch() {
    coordinator.onPosition(latitude: 52.2, longitude: 21.0)
    // The ride keeps moving while the request is out; those Fixes must not simply be dropped.
    coordinator.onPosition(latitude: 52.3, longitude: 21.0)
    coordinator.onPosition(latitude: 52.5, longitude: 21.0)
    XCTAssertEqual(transport.inFlight, 1)

    transport.resolveLast(forecastBody(20))

    XCTAssertEqual(transport.urls.count, 2)
    XCTAssertTrue(transport.urls.last?.contains("latitude=52.5") == true)
  }

  func testDropsAMidFetchPositionThatTheLandedForecastAlreadyDescribes() {
    coordinator.onPosition(latitude: 52.2000, longitude: 21.0)
    coordinator.onPosition(latitude: 52.2001, longitude: 21.0)

    transport.resolveLast(forecastBody(20))

    XCTAssertEqual(transport.urls.count, 1)
  }

  func testKeepsTheLastGoodForecastWhenALaterRefreshFails() {
    coordinator.onPosition(latitude: 52.2, longitude: 21.0)
    transport.resolveLast(forecastBody(20))

    now += WeatherCoordinator.forecastTtlMs
    coordinator.onPosition(latitude: 52.2, longitude: 21.0)
    transport.resolveLast(nil)

    XCTAssertEqual(coordinator.current?.temperatureC, 20)
  }

  func testStartsEmptyAndIgnoresARiderRefreshBeforeTheFirstFetch() {
    coordinator.refresh()

    XCTAssertNil(coordinator.current)
    XCTAssertEqual(transport.urls.count, 0)
  }

  func testNotifiesListenersOnEverySuccessfulRefreshOnly() {
    var seen: [Int?] = []
    coordinator.onChange = { seen.append($0?.temperatureC) }

    coordinator.onPosition(latitude: 52.2, longitude: 21.0)
    transport.resolveLast(forecastBody(20))
    now += WeatherCoordinator.forecastTtlMs
    coordinator.onPosition(latitude: 52.2, longitude: 21.0)
    transport.resolveLast(nil)

    XCTAssertEqual(seen.count, 1)
    XCTAssertEqual(seen.first, 20)
  }
}
