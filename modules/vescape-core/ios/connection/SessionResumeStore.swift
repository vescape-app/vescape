import Foundation

internal struct SessionResumeMarker: Equatable {
  let appBoardId: String
  let bleId: String
  let recordingActive: Bool
}

/// @platform-diff Android has no peer: its `CoreForegroundService` keeps the process alive, so
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
      recordingActive: raw["recordingActive"] as? Bool ?? false
    )
  }

  func save(appBoardId: String, bleId: String, recordingActive: Bool) {
    let raw: [String: Any] = [
      "appBoardId": appBoardId,
      "bleId": bleId,
      "recordingActive": recordingActive,
    ]
    defaults.set(raw, forKey: key)
  }

  func setRecording(active: Bool) {
    guard var raw = defaults.dictionary(forKey: key) else { return }
    guard (raw["recordingActive"] as? Bool ?? false) != active else { return }
    raw["recordingActive"] = active
    defaults.set(raw, forKey: key)
  }

  func clear() {
    defaults.removeObject(forKey: key)
  }
}
