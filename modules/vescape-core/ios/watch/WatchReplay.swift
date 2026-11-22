import Foundation

/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `ReplaySceneParser`
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

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `ReplaySceneParser.parseOrigin`
  static func parseOrigin(json: String) -> WatchMapPosition? {
    // intentional-suppression: a fixture without an origin replays with no map position.
    guard let fixture = try? JSONDecoder().decode(RouteFixture.self, from: Data(json.utf8)),
      let origin = fixture.origin
    else { return nil }
    return WatchMapPosition(latitude: origin.latitude, longitude: origin.longitude)
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `ReplaySceneParser.parseMapTiles`
  static func parseMapTiles(json: String) -> WatchMapTileList? {
    // intentional-suppression: malformed replay fixtures return nil; the replay driver logs the failure.
    let payload = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
    return WatchMapTileList.decode(payload)
  }

  private struct RouteFixture: Decodable {
    let origin: Origin?
    let points: [Point]

    struct Origin: Decodable {
      let latitude: Double
      let longitude: Double
    }

    struct Point: Decodable {
      let east: Double
      let north: Double
    }
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `ReplaySceneParser.parseWeather`
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

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `ReplaySceneParser.parseGroupRide`
  static func parseGroupRide(json: String) -> ReplayGroupRide? {
    // intentional-suppression: malformed replay fixtures return nil; the replay driver logs the failure.
    guard let fixture = try? JSONDecoder().decode(GroupRideFixture.self, from: Data(json.utf8)),
      !fixture.riders.isEmpty
    else { return nil }
    var riders: [ReplayGroupRider] = []
    for rider in fixture.riders {
      guard let color = UInt32(rider.color.replacingOccurrences(of: "#", with: ""), radix: 16) else {
        return nil
      }
      riders.append(ReplayGroupRider(
        rider: GroupRideFrameRider(
          id: rider.id, name: rider.name, colorArgb: 0xFF00_0000 | color,
          eastM: rider.east, northM: rider.north, stale: rider.stale ?? false,
          batteryPercent: rider.battery,
          batteryLevel: replayLevel(rider.batteryLevel), heatLevel: replayLevel(rider.heatLevel)
        ),
        swingEastM: rider.swing?.east ?? 0,
        swingNorthM: rider.swing?.north ?? 0,
        swingPeriodMs: Int64((rider.swing?.periodS ?? 0) * 1000)
      ))
    }
    return ReplayGroupRide(courseDeg: fixture.courseDeg, spanM: fixture.spanM, riders: riders)
  }

  private static func replayLevel(_ name: String?) -> TelemetryLevel {
    switch name?.lowercased() {
    case "warning": return .warning
    case "critical": return .critical
    default: return .normal
    }
  }

  private struct GroupRideFixture: Decodable {
    let courseDeg: Double?
    let spanM: Double
    let riders: [Rider]

    struct Rider: Decodable {
      let id: String
      let name: String
      let color: String
      let east: Double
      let north: Double
      let stale: Bool?
      let battery: Int?
      let batteryLevel: String?
      let heatLevel: String?
      let swing: Swing?
    }

    struct Swing: Decodable {
      let east: Double?
      let north: Double?
      let periodS: Double?
    }
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

/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `ReplayGroupRide`
struct ReplayGroupRide: Equatable {
  let courseDeg: Double?
  let spanM: Double
  let riders: [ReplayGroupRider]

  func frame(atMs elapsedMs: Int64, courseDeg: Double?) -> GroupRideFrame {
    GroupRideFrame(
      courseDeg: courseDeg ?? self.courseDeg, spanM: spanM,
      riders: riders.map { $0.at(elapsedMs) }
    )
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `ReplayGroupRider`
struct ReplayGroupRider: Equatable {
  let rider: GroupRideFrameRider
  let swingEastM: Double
  let swingNorthM: Double
  let swingPeriodMs: Int64

  func at(_ elapsedMs: Int64) -> GroupRideFrameRider {
    guard swingPeriodMs > 0 else { return rider }
    let wave = sin(2 * Double.pi * Double(elapsedMs) / Double(swingPeriodMs))
    var moved = rider
    moved.eastM += swingEastM * wave
    moved.northM += swingNorthM * wave
    return moved
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `ReplaySample`
struct ReplaySample: Equatable {
  let atMs: Int64
  let frame: WatchFrame
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `ReplayFixtureParser`
enum ReplayFixtureParser {
  static func parse<S: Sequence>(
    _ lines: S, wander: Bool = false, origin: WatchMapPosition? = nil
  ) -> [ReplaySample] where S.Element == String {
    let recorded = lines.compactMap(parseLine)
    let samples = wander ? withDetours(recorded) : recorded
    return samples.enumerated().map { index, sample in
      var frame = sample.frame
      if let east = frame.riderEastM, let north = frame.riderNorthM {
        frame.mapPosition = origin.map { WatchMirrorReplayAdapter.position(origin: $0, eastM: east, northM: north) }
        let count = min(index + 1, WatchTrailCodec.maxPoints)
        frame.trail = (0..<count).compactMap { i in
          let point = samples[count == 1 ? 0 : i * index / (count - 1)].frame
          guard let x = point.riderEastM, let y = point.riderNorthM else { return nil }
          return WatchTrailPoint(eastM: x - east, northM: y - north)
        }
      }
      return ReplaySample(atMs: sample.atMs, frame: frame)
    }
  }

  static func parse(text: String, wander: Bool = false, origin: WatchMapPosition? = nil) -> [ReplaySample] {
    parse(text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init), wander: wander, origin: origin)
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `ReplayFixtureParser.withDetours`
  private static func withDetours(_ samples: [ReplaySample]) -> [ReplaySample] {
    func target(_ node: Int64, _ axis: Int64) -> Double {
      if node % 4 == 0 { return 0 }
      var seed = ((node * 2 + axis) * 1664525 + 1013904223) & 0xffffffff
      seed = ((seed ^ (seed >> 16)) * 1664525 + 1013904223) & 0xffffffff
      return (Double(seed) / 4294967295.0 * 2 - 1) * 35
    }
    var previous: WatchFrame?
    return samples.map { sample in
      guard let east = sample.frame.riderEastM, let north = sample.frame.riderNorthM else { return sample }
      let node = sample.atMs / 30_000
      let t = Double(sample.atMs % 30_000) / 30_000
      let eased = t * t * (3 - 2 * t)
      func offset(_ axis: Int64) -> Double { target(node, axis) + (target(node + 1, axis) - target(node, axis)) * eased }
      var frame = sample.frame
      let x = east + offset(0)
      let y = north + offset(1)
      if let px = previous?.riderEastM, let py = previous?.riderNorthM, hypot(x - px, y - py) > 0.1 {
        frame.courseDeg = (atan2(x - px, y - py) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
      }
      frame.riderEastM = x
      frame.riderNorthM = y
      previous = frame
      return ReplaySample(atMs: sample.atMs, frame: frame)
    }
  }

  private static func parseLine(_ line: String) -> ReplaySample? {
    guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
    guard
      let data = line.data(using: .utf8),
      // intentional-suppression: an unparseable fixture line is a skipped sample, not a failure
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let atMs = (json["t"] as? NSNumber)?.int64Value,
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
        navBearingDeg: lane(json, "navBearing"),
        navDistanceM: lane(json, "navDistance"),
        riderEastM: lane(json, "riderEast"),
        riderNorthM: lane(json, "riderNorth"),
        courseDeg: lane(json, "course"),
        routeSpanM: lane(json, "routeSpanM")
      )
    )
  }

  private static func lane(_ json: [String: Any], _ key: String) -> Double? {
    guard let number = json[key] as? NSNumber else { return nil }
    let value = number.doubleValue
    return value.isNaN ? nil : value
  }
}
