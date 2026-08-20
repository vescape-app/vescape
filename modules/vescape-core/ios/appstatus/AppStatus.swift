import Foundation

/// Release Policy outcome for the installed marketing version, resolved **by the server**. Native
/// never evaluates SemVer ranges — it only carries the resolved slug across the bridge.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `AppVersionStatus`
/// @parity /modules/vescape-core/src/index.ts `AppVersionStatus`
enum AppVersionStatus: String {
  case current
  case updateWarning = "update-warning"
  case onlineBlocked = "online-blocked"
  case appBlocked = "app-blocked"

  /// Whether this outcome denies online work (Group Ride and future backup/sync). Online Block and
  /// App Block both deny it; `current` and `update-warning` permit it. No TS peer: only the native
  /// Group Ride gate consumes it, and JS learns of a block via the `blocked` observe state.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `blocksOnline`
  var blocksOnline: Bool { self == .onlineBlocked || self == .appBlocked }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `CommunityMessageType`
/// @parity /modules/vescape-core/src/index.ts `CommunityMessageType`
enum CommunityMessageType: String {
  case info
  case warning
  case critical
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `CommunityMessageActionType`
/// @parity /modules/vescape-core/src/index.ts `CommunityMessageActionType`
enum CommunityMessageActionType: String {
  case primary
  case secondary
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `CommunityMessageAction`
/// @parity /modules/vescape-core/src/index.ts `CommunityMessageAction`
struct CommunityMessageAction: Equatable {
  let type: CommunityMessageActionType
  let label: String
  let url: String

  func toMap() -> [String: Any?] {
    ["type": type.rawValue, "label": label, "url": url]
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `CommunityMessage`
/// @parity /modules/vescape-core/src/index.ts `CommunityMessage`
struct CommunityMessage: Equatable {
  let id: String
  let type: CommunityMessageType
  let title: String?
  let body: String
  let action: CommunityMessageAction?

  func toMap() -> [String: Any?] {
    ["id": id, "type": type.rawValue, "title": title, "body": body, "action": action?.toMap()]
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `AppStatusVersion`
/// @parity /modules/vescape-core/src/index.ts `AppStatusVersion`
struct AppStatusVersion: Equatable {
  let installed: String
  let latest: String
  let status: AppVersionStatus
  let message: String?

  func toMap() -> [String: Any?] {
    ["installed": installed, "latest": latest, "status": status.rawValue, "message": message]
  }
}

/// One resolved App Status snapshot as served by `GET /api/app-status`. Held in memory for the
/// running process only — never persisted, so a fresh process starts unknown (fail-open).
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `AppStatus`
/// @parity /modules/vescape-core/src/index.ts `AppStatus`
struct AppStatus: Equatable {
  let version: AppStatusVersion
  let messages: [CommunityMessage]

  func toMap() -> [String: Any?] {
    ["version": version.toMap(), "messages": messages.map { $0.toMap() }]
  }
}

/// Decode an App Status response body. Unknown additive fields are ignored; any invalid or missing
/// **required** field yields `nil`, which callers treat exactly like a transport failure.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `parseAppStatus`
func decodeAppStatus(_ body: Data) -> AppStatus? {
  guard let object = try? JSONSerialization.jsonObject(with: body),
        let root = object as? [String: Any]
  else { return nil }
  guard let versionJson = root["version"] as? [String: Any],
        let version = decodeVersion(versionJson)
  else { return nil }
  return AppStatus(version: version, messages: decodeMessages(root["messages"]))
}

private func decodeVersion(_ json: [String: Any]) -> AppStatusVersion? {
  guard let installed = json.nonEmptyString("installed"),
        let latest = json.nonEmptyString("latest"),
        let statusSlug = json.nonEmptyString("status"),
        let status = AppVersionStatus(rawValue: statusSlug)
  else { return nil }
  // Absent message is legitimate (a rule may carry none); a present-but-malformed one is not.
  var message: String?
  if json.hasValue("message") {
    guard let resolved = json.nonEmptyString("message") else { return nil }
    message = resolved
  }
  return AppStatusVersion(installed: installed, latest: latest, status: status, message: message)
}

/// Decode the message array. Community Messages are independent of Release Policy, so nothing here
/// can invalidate the resolved version status: an absent, null or non-array `messages` field means
/// "no messages", and an individual invalid entry is skipped so one bad message never hides the
/// valid ones.
private func decodeMessages(_ value: Any?) -> [CommunityMessage] {
  guard let json = value as? [Any] else { return [] }
  var messages: [CommunityMessage] = []
  for entry in json {
    guard let object = entry as? [String: Any], let message = decodeMessage(object) else { continue }
    messages.append(message)
  }
  return messages
}

private func decodeMessage(_ json: [String: Any]) -> CommunityMessage? {
  guard let id = json.nonEmptyString("id"),
        let typeSlug = json.nonEmptyString("type"),
        let type = CommunityMessageType(rawValue: typeSlug),
        let body = json.nonEmptyString("body")
  else { return nil }
  // Absent title is legitimate (the app falls back to its per-type label); a malformed one is not.
  var title: String?
  if json.hasValue("title") {
    guard let resolved = json.nonEmptyString("title") else { return nil }
    title = resolved
  }
  var action: CommunityMessageAction?
  if json.hasValue("action") {
    guard let actionJson = json["action"] as? [String: Any],
          let resolved = decodeAction(actionJson)
    else { return nil }
    action = resolved
  }
  return CommunityMessage(id: id, type: type, title: title, body: body, action: action)
}

private func decodeAction(_ json: [String: Any]) -> CommunityMessageAction? {
  guard let typeSlug = json.nonEmptyString("type"),
        let type = CommunityMessageActionType(rawValue: typeSlug),
        let label = json.nonEmptyString("label"),
        let url = json.nonEmptyString("url")
  else { return nil }
  return CommunityMessageAction(type: type, label: label, url: url)
}

private extension Dictionary where Key == String, Value == Any {
  /// A required string field: present, textual, and non-empty — otherwise `nil`.
  func nonEmptyString(_ key: String) -> String? {
    guard let value = self[key] as? String, !value.isEmpty else { return nil }
    return value
  }

  /// True when the key is present and not JSON `null` — i.e. the server meant to send something.
  func hasValue(_ key: String) -> Bool {
    guard let value = self[key] else { return false }
    return !(value is NSNull)
  }
}
