import Foundation

/// Simulator-only Watch Frame replay: feeds recorded lane samples into ``PhoneLink`` on the same
/// path a phone push takes, so Mirror visuals — including the Always On rendering, which no unit
/// test can show you — can be worked on without a board, a phone or a ride.
///
/// The watch never sees board protocol (ADR-0019), so the fixtures are lane-only JSONL generated on
/// the host by `scripts/generate-watch-fixtures.ts` from a Debug Recording. They are the Wear OS
/// assets, read straight off the repo tree rather than copied into this bundle: a copy is a second
/// artefact that drifts, and the whole value of replaying these is that both wrists are fed the
/// same bytes.
///
/// Reading the repo tree is only possible because replay is gated to the simulator, which shares
/// the host filesystem. The path arrives as a launch argument rather than being written down here,
/// so nothing machine-specific lives in the source.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `FrameReplayer`
final class FrameReplayer {
  private let link: PhoneLink
  private var samples: [ReplaySample] = []
  private var task: Task<Void, Never>?
  /// The tilt a replayed phone would be commanding: the last lock the wrist sent, or neutral. Read
  /// and written on the main actor only — the replay loop and the wrist's sends both run there.
  private var tilt = WatchTiltStick.center

  init(link: PhoneLink) {
    self.link = link
  }

  /// Stand in for the phone's Remote Tilt so the Tilt page can be felt in the simulator: a lock is
  /// echoed into every following frame, a cancel (`value` nil) returns to neutral at once.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `echoTilt`
  func echoTilt(_ value: Int?) {
    tilt = value ?? WatchTiltStick.center
  }

  /// The gate every dev mode passes through. A dev mode is explicit and never inferred: a normal
  /// launch listens to its paired phone like a real watch instead of silently replacing those
  /// frames with a fixture, and a device build has no replay path at all.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `DevGate`
  static var requestedFixture: String? {
#if targetEnvironment(simulator)
    let arguments = ProcessInfo.processInfo.arguments
    guard let flag = arguments.firstIndex(of: "--replay"), flag + 1 < arguments.count else { return nil }
    return arguments[flag + 1]
#else
    return nil
#endif
  }

  /// Plays a fixture at its recorded pace, looping forever so the wrist keeps moving while the
  /// visuals are being worked on.
  func start(fixture: String) {
    guard task == nil else { return }
    guard
      let text = try? String(contentsOfFile: fixture, encoding: .utf8)
    else { return }
    samples = ReplayFixtureParser.parse(text: text)
    guard !samples.isEmpty else { return }
    task = Task { @MainActor [samples, link, weak self] in
      link.recordReplay(fixture: (fixture as NSString).lastPathComponent, sampleCount: samples.count)
      // Same companion asset as Wear OS, beside either ride or sweep telemetry.
      // @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `loadScene`
      let sceneURL = URL(fileURLWithPath: fixture).deletingLastPathComponent()
      let routeURL = sceneURL.appendingPathComponent("watch-route.json")
      if let json = try? String(contentsOf: routeURL, encoding: .utf8) {
        let route = ReplaySceneParser.parseRoute(json: json)
        link.acceptReplayRoute(route)
        if route == nil { print("[replay] invalid route fixture: \(routeURL.path)") }
      } else {
        print("[replay] missing route fixture: \(routeURL.path)")
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
      while !Task.isCancelled {
        var previous: Int64 = 0
        for sample in samples {
          try? await Task.sleep(for: .milliseconds(max(sample.atMs - previous, 0)))
          guard !Task.isCancelled else { return }
          previous = sample.atMs
          var frame = sample.frame
          if let tilt = self?.tilt {
            frame.remoteTilt = tilt
            frame.tiltControl = tilt == WatchTiltStick.center ? .free : .manual
          }
          link.acceptReplayFrame(frame)
        }
      }
    }
  }

  func stop() {
    task?.cancel()
    task = nil
  }
}
