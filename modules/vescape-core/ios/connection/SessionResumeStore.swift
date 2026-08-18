import Foundation

/// What a headless relaunch needs to know about the Board Session that was live when the process
/// died (ADR 0034). Everything else — Board Link, poll rate, battery config — is re-read from
/// `AppDataRepository` at resume time, so this stays a pointer, not a snapshot.
internal struct SessionResumeMarker: Equatable {
  let appBoardId: String
  let bleId: String
  /// Whether Ride Recording was writing frames. A resumed session re-enables it so telemetry keeps
  /// appending to the same open recording (the history gap-splitter explains the dead interval).
  let recordingActive: Bool
  let savedAtMs: Int64
}

/// Durable "a Board Session was live" marker, written at session begin and cleared at session end.
///
/// Its only job is to gate work at launch: CoreBluetooth state restoration requires the session
/// central to be re-created inside `didFinishLaunching`, and a normal cold start must not spin up
/// BLE for nothing. `UserDefaults` rather than GRDB deliberately — it is readable before anything
/// else in the app has booted.
///
/// @platform-diff Android has no peer: its `CoreForegroundService` keeps the process alive, so
/// there is no death to resume from and no launch marker to keep.
internal final class SessionResumeStore {
  static let shared = SessionResumeStore(defaults: .standard)

  private let defaults: UserDefaults
  private let key = "vescape.session.resume"

  init(defaults: UserDefaults) {
    self.defaults = defaults
  }

  var pending: SessionResumeMarker? {
    guard let raw = defaults.dictionary(forKey: key) else { return nil }
    guard
      let appBoardId = raw["appBoardId"] as? String, !appBoardId.isEmpty,
      let bleId = raw["bleId"] as? String, !bleId.isEmpty
    else { return nil }
    return SessionResumeMarker(
      appBoardId: appBoardId,
      bleId: bleId,
      recordingActive: raw["recordingActive"] as? Bool ?? false,
      savedAtMs: (raw["savedAtMs"] as? NSNumber)?.int64Value ?? 0
    )
  }

  func save(appBoardId: String, bleId: String, recordingActive: Bool, nowMs: Int64) {
    defaults.set(
      [
        "appBoardId": appBoardId,
        "bleId": bleId,
        "recordingActive": recordingActive,
        "savedAtMs": NSNumber(value: nowMs),
      ],
      forKey: key
    )
  }

  /// Recording is toggled mid-session (auto-recording at board-ready, the JS switch), so the flag
  /// is refreshed in place rather than only at session begin.
  func setRecordingActive(_ active: Bool) {
    guard var raw = defaults.dictionary(forKey: key) else { return }
    guard (raw["recordingActive"] as? Bool ?? false) != active else { return }
    raw["recordingActive"] = active
    defaults.set(raw, forKey: key)
  }

  func clear() {
    defaults.removeObject(forKey: key)
  }
}
