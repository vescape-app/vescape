import Foundation

/// Shared with Wear OS; forecast times are anchored once when replay starts.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `ReplaySceneParser.parseWeather`
enum ReplaySceneParser {
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `ReplaySceneParser.parseRoute`
  static func parseRoute(json: String) -> WatchRoute? {
    // intentional-suppression: malformed replay fixtures return nil; the replay driver logs the failure.
    guard let fixture = try? JSONDecoder().decode(RouteFixture.self, from: Data(json.utf8)),
      !fixture.points.isEmpty
    else { return nil }
    return WatchRoute(points: fixture.points.map {
      WatchRoutePoint(eastM: $0.east, northM: $0.north)
    })
  }

  private struct RouteFixture: Decodable {
    let points: [Point]

    struct Point: Decodable {
      let east: Double
      let north: Double
    }
  }

  static func parseWeather(json: String, nowMs: Int64, minuteOfDay: Int) -> WatchWeather? {
    // intentional-suppression: malformed replay fixtures return nil; the replay driver logs the failure.
    guard let fixture = try? JSONDecoder().decode(WeatherFixture.self, from: Data(json.utf8)) else {
      return nil
    }
    let firstHour = (minuteOfDay / 60 + 1) * 60
    return WatchWeather(
      temperatureC: fixture.temperatureC, icon: fixture.icon, label: fixture.label,
      precipitationProbability: fixture.precipitationProbability,
      hourly: fixture.hourly.enumerated().map { index, hour in
        WatchWeatherHour(
          minuteOfDay: (firstHour + index * 60) % (24 * 60),
          temperatureC: hour.temperatureC, icon: hour.icon,
          precipitationProbability: hour.precipitationProbability
        )
      },
      sunriseMinuteOfDay: fixture.sunriseMinuteOfDay,
      sunsetMinuteOfDay: fixture.sunsetMinuteOfDay,
      latitude: fixture.latitude, longitude: fixture.longitude, fetchedAtMs: nowMs
    )
  }

  private struct WeatherFixture: Decodable {
    let temperatureC: Int
    let icon: String
    let label: String
    let precipitationProbability: Int
    let sunriseMinuteOfDay: Int
    let sunsetMinuteOfDay: Int
    let latitude: Double?
    let longitude: Double?
    let hourly: [Hour]

    struct Hour: Decodable {
      let temperatureC: Int
      let icon: String
      let precipitationProbability: Int
    }
  }
}

/// One recorded moment: the frame to show and the recording-relative time to show it at.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `ReplaySample`
struct ReplaySample: Equatable {
  let atMs: Int64
  let frame: WatchFrame
}

/// Pure lane-fixture parser for the JSONL recordings in `watch/wearos/src/main/assets/`, generated
/// on the host by `scripts/generate-watch-fixtures.ts` from a Debug Recording.
///
/// The fixtures are the shared artefact between the two wrists: the same bytes feed the Wear OS
/// replay and these tests, so "the watchOS gauges read the same as the Android ones" is checked
/// against recorded rider data rather than against a hand-written frame that agrees with whatever
/// the code currently does.
///
/// A fixture is dev input, so a malformed line is skipped rather than fatal — a partly-readable
/// fixture still animates the gauges. The driver that plays them is wrist-only
/// (`watch/watchos/FrameReplay.swift`); this half is the part with a right answer, so it is the
/// half that is tested — the same split Android makes.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `ReplayFixtureParser`
enum ReplayFixtureParser {
  static func parse<S: Sequence>(_ lines: S) -> [ReplaySample] where S.Element == String {
    lines.compactMap(parseLine)
  }

  static func parse(text: String) -> [ReplaySample] {
    parse(text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init))
  }

  private static func parseLine(_ line: String) -> ReplaySample? {
    guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
    guard
      let data = line.data(using: .utf8),
      // intentional-suppression: an unparseable fixture line is a skipped sample, not a failure
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let atMs = (json["t"] as? NSNumber)?.int64Value,
      // Speed is the one required lane: a line without it is not a frame, it is a truncated write.
      let speed = lane(json, "speed")
    else { return nil }

    return ReplaySample(
      atMs: atMs,
      frame: WatchFrame(
        speed: speed,
        duty: lane(json, "duty"),
        battery: lane(json, "battery"),
        motorTemp: lane(json, "motorTemp"),
        ctrlTemp: lane(json, "ctrlTemp"),
        stale: json["stale"] as? Bool ?? false,
        navBearing: lane(json, "navBearing"),
        navDistanceM: lane(json, "navDistance"),
        riderEastM: lane(json, "riderEast"),
        riderNorthM: lane(json, "riderNorth"),
        courseDeg: lane(json, "course"),
        routeSpanM: lane(json, "routeSpanM")
      )
    )
  }

  /// An absent lane and an explicit `null` are the same thing: unreported. Both render as a dash.
  private static func lane(_ json: [String: Any], _ key: String) -> Double? {
    guard let number = json[key] as? NSNumber else { return nil }
    let value = number.doubleValue
    return value.isNaN ? nil : value
  }
}
