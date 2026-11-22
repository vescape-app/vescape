import Foundation

/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `FrameReplayer`
@MainActor
final class FrameReplayer {
  private let link: PhoneLink
  private var samples: [ReplaySample] = []
  private var task: Task<Void, Never>?
  private var tilt = WatchTiltStick.center
  private var courseDeg: Double?
  private var groupTask: Task<Void, Never>?

  init(link: PhoneLink) {
    self.link = link
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `FrameReplayer.echoTilt`
  func echoTilt(_ value: Int?) {
    tilt = value ?? WatchTiltStick.center
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `DevGate`
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MainActivity.kt `replayFixture`
  static var requestedFixture: String? {
#if targetEnvironment(simulator)
    let arguments = ProcessInfo.processInfo.arguments
    guard let flag = arguments.firstIndex(of: "--replay"), flag + 1 < arguments.count else { return nil }
    return arguments[flag + 1]
#else
    return nil
#endif
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MainActivity.kt `replayGroup`
  static var requestedGroup: Bool {
#if targetEnvironment(simulator)
    return ProcessInfo.processInfo.arguments.contains("--group")
#else
    return false
#endif
  }

  func start(fixture: String, group: Bool, routeLoading: Bool = false) {
    guard task == nil else { return }
    guard
      let text = try? String(contentsOfFile: fixture, encoding: .utf8)
    else { return }
    // @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `loadScene`
    let sceneURL = URL(fileURLWithPath: fixture).deletingLastPathComponent()
    let routeURL = sceneURL.appendingPathComponent("watch-route.json")
    let routeJSON = try? String(contentsOf: routeURL, encoding: .utf8)
    let origin = routeJSON.flatMap { ReplaySceneParser.parseOrigin(json: $0) }
    samples = ReplayFixtureParser.parse(
      text: text, wander: ProcessInfo.processInfo.arguments.contains("--wander"), origin: origin)
    guard !samples.isEmpty else { return }
    task = Task { @MainActor [samples, link, weak self] in
      link.acceptReplaySettings([
        WatchSettingsKey.telemetryTrailEnabled: !ProcessInfo.processInfo.arguments.contains("--no-telemetry-trail"),
      ])
      link.recordReplay(fixture: (fixture as NSString).lastPathComponent, sampleCount: samples.count)
      if let routeJSON {
        let route = ReplaySceneParser.parseRoute(json: routeJSON)
        link.acceptReplayRoute(route, origin: origin)
        if route == nil || origin == nil { print("[replay] invalid route fixture: \(routeURL.path)") }
      } else {
        print("[replay] missing route fixture: \(routeURL.path)")
      }
      link.acceptReplayRouteStatus(routeLoading ? WatchRouteStatus(phase: .ready, routeId: 1) : nil)
      if routeLoading { link.acceptReplayRoute(nil, origin: origin) }
      let mapTilesURL = sceneURL.appendingPathComponent("watch-map-tiles.json")
      if let json = try? String(contentsOf: mapTilesURL, encoding: .utf8),
        let tiles = ReplaySceneParser.parseMapTiles(json: json)
      {
        link.acceptReplayMapTiles(tiles, directory: sceneURL.appendingPathComponent("watch-map-tiles"))
      } else {
        print("[replay] missing or invalid map tile fixture: \(mapTilesURL.path)")
      }
      let weatherURL = sceneURL.appendingPathComponent("watch-weather.json")
      if let json = try? String(contentsOf: weatherURL, encoding: .utf8) {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        if let weather = ReplaySceneParser.parseWeather(
          json: json, nowMs: nowMs, minuteOfDay: watchMinuteOfDay(epochMs: nowMs)
        ) {
          link.acceptReplayWeather(weather)
        } else {
          print("[replay] invalid weather fixture: \(weatherURL.path)")
        }
      } else {
        print("[replay] missing weather fixture: \(weatherURL.path)")
      }
      if group { self?.startGroupRide(sceneURL: sceneURL) }
      while !Task.isCancelled {
        var previous: Int64 = 0
        for sample in samples {
          try? await Task.sleep(for: .milliseconds(max(sample.atMs - previous, 0)))
          guard !Task.isCancelled else { return }
          previous = sample.atMs
          var frame = sample.frame
          if let course = frame.courseDeg { self?.courseDeg = course }
          if let tilt = self?.tilt {
            frame.remoteTilt = tilt
            frame.tiltControl = tilt == WatchTiltStick.center ? .free : .manual
          }
          if ProcessInfo.processInfo.arguments.contains("--no-navigation") {
            frame.navBearingDeg = nil
            frame.navDistanceM = nil
            frame.riderEastM = nil
            frame.riderNorthM = nil
          }
          link.acceptReplayFrame(frame)
        }
      }
    }
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `FrameReplayer.pushGroupRide`
  @MainActor
  private func startGroupRide(sceneURL: URL) {
    let groupURL = sceneURL.appendingPathComponent("watch-group-ride.json")
    guard let json = try? String(contentsOf: groupURL, encoding: .utf8),
      let groupRide = ReplaySceneParser.parseGroupRide(json: json)
    else {
      print("[replay] missing or invalid group ride fixture: \(groupURL.path)")
      return
    }
    groupTask = Task { @MainActor [link, weak self] in
      let started = Date()
      while !Task.isCancelled {
        let elapsedMs = Int64(Date().timeIntervalSince(started) * 1000)
        link.acceptReplayGroupRide(groupRide.frame(atMs: elapsedMs, courseDeg: self?.courseDeg))
        try? await Task.sleep(for: .seconds(1))
      }
    }
  }

  func stop() {
    task?.cancel()
    task = nil
    groupTask?.cancel()
    groupTask = nil
  }
}
