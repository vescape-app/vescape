import Foundation
import GRDB

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `AppDataScope`
/// @parity /modules/vescape-core/src/index.ts `AppDataChangedEvent`
enum AppDataScope: String {
  case boards
  case alerts
  case settings
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt
final class AppDataRepository {
  static let shared = AppDataRepository()

  static var onDataChanged: ((String) -> Void)?

  private let dbWriter: (any DatabaseWriter)?

  private var writer: (any DatabaseWriter)? { dbWriter ?? VescapeDatabase.pool }

  private enum StorageUnavailable: Error { case databaseNotOpen }
  private enum InvalidInput: Error { case alertRuleIdentity }

  private func boardSettingsPersistence() throws -> BoardSettingsPersistence {
    guard let writer else { throw StorageUnavailable.databaseNotOpen }
    return BoardSettingsPersistence(writer: writer)
  }

  private init(dbWriter: (any DatabaseWriter)? = nil) {
    self.dbWriter = dbWriter
  }

  static func forTesting(dbWriter: any DatabaseWriter) -> AppDataRepository {
    AppDataRepository(dbWriter: dbWriter)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `notifyDataChanged`
  private func notifyDataChanged(_ scope: AppDataScope) {
    Self.onDataChanged?(scope.rawValue)
  }

  private func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `getBoards`
  func getBoards() throws -> [[String: Any?]] {
    let persistence = try boardSettingsPersistence()
    let boards = try persistence.liveBoards()
    let settings = try persistence.boardSettings(ids: boards.map(\.id))
    let byBoard = Dictionary(grouping: settings, by: \.boardId)
    return boards.map { Self.composeBoard($0, settings: byBoard[$0.id, default: []].map { ($0.key, $0.valueJson) }) }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `getBoard`
  func getBoard(_ id: String) throws -> [String: Any?]? {
    let persistence = try boardSettingsPersistence()
    guard let board = try persistence.board(id: id) else { return nil }
    let settings = try persistence.boardSettings(ids: [id]).map { ($0.key, $0.valueJson) }
    return Self.composeBoard(board, settings: settings)
  }

  func applyAlertPreset(_ boardId: String, _ metric: String, _ level: String?, _ geiger: String?, _ match: Bool?) throws {
    guard let writer else { throw StorageUnavailable.databaseNotOpen }
    try AlertPresetPersistence(writer: writer).apply(boardId: boardId, metric: metric, level: level, geiger: geiger, match: match)
    Self.onDataChanged?(AppDataScope.alerts.rawValue)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `upsertBoard`
  func upsertBoard(_ board: [String: Any?], initialAlerts: [String: Any]? = nil) throws {
    guard let id = board["id"] as? String else { return }
    let name = board["name"] as? String ?? ""
    let createdAt = Self.longValue(board["createdAt"] ?? nil) ?? nowMs()
    let link = BoardLinkPersistence.normalized(board["link"] ?? nil)
    let bleId = link?["bleId"] as? String
    let linkSettings = BoardLinkPersistence.settings(from: board["link"] ?? nil)

    let ignoredConfigChangeFields = Self.normalizeStringList(board["ignoredConfigChangeFields"] ?? nil)
    let settings: [(String, Any?)] = [
      ("description", (board["description"] as? String).flatMap { $0.isEmpty ? nil : $0 }),
      ("personalization", Self.normalizePersonalization(board["personalization"] ?? nil)),
      ("batteryConfig", Self.normalizeBatteryConfig(board["batteryConfig"] ?? nil)),
      ("dismissedWarnings", Self.normalizeStringList(board["dismissedWarnings"] ?? nil)),
      (BoardConfigChangeNotice.ignoredFieldsSettingKey, ignoredConfigChangeFields),
      ("topSpeedKmh", Self.topSpeedKmh(board["topSpeedKmh"] ?? nil)),
      ("alertPresetsOnboarded", board["alertPresetsOnboarded"] as? Bool),
    ] + linkSettings
    let updatedAt = nowMs()

    let encoded = try settings.compactMap { key, value -> PersistedBoardSetting? in
      guard let value else { return nil }
      return PersistedBoardSetting(
        boardId: id, key: key, valueJson: try Self.encodeJson(value), updatedAt: updatedAt
      )
    }
    let deletedKeys = settings.compactMap { key, value in value == nil ? key : nil }
    try boardSettingsPersistence().upsertBoard(
      PersistedBoard(id: id, name: name, bleId: bleId, createdAt: createdAt, deletedAt: nil),
      settings: encoded,
      deletedKeys: deletedKeys,
      alerts: try initialAlerts.map { try Self.initialAlertRows(boardId: id, $0, now: updatedAt) } ?? []
    )
    notifyDataChanged(.boards)
    notifyDataChanged(.alerts)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `deleteBoardWithSettings`
  func deleteBoard(_ id: String) throws {
    let deletedAt = nowMs()
    try boardSettingsPersistence().tombstoneBoard(id: id, deletedAt: deletedAt)
    notifyDataChanged(.boards)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `updateLastBattery`
  func updateLastBattery(boardId: String, percent: Double, voltage: Double?, atMs: Int64) throws {
    let value: [String: Any] = ["percent": percent, "voltage": voltage ?? NSNull(), "at": atMs]
    let json = try Self.encodeJson(value)
    try boardSettingsPersistence().saveBoardSetting(PersistedBoardSetting(boardId: boardId, key: "lastBattery", valueJson: json, updatedAt: atMs))
    notifyDataChanged(.boards)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `updateLegalMode`
  func updateLegalMode(boardId: String, enabled: Bool) throws {
    let json = try Self.encodeJson(["enabled": enabled])
    try boardSettingsPersistence().saveBoardSetting(PersistedBoardSetting(boardId: boardId, key: "legalMode", valueJson: json, updatedAt: nowMs()))
    notifyDataChanged(.boards)
  }

  private static func composeBoard(_ row: Row, settings: [(String, String)]) -> [String: Any?] {
    var values: [String: Any] = [:]
    for (key, json) in settings {
      if let decoded = decodeBoardSetting(key: key, json: json) { values[key] = decoded }
    }
    let bleId: String? = row["ble_id"]
    let link = BoardLinkPersistence.compose(bleId: bleId, values: values)
    return [
      "id": row["id"] as String,
      "name": row["name"] as String,
      "description": values["description"],
      "personalization": values["personalization"],
      "createdAt": row["created_at"] as Int64,
      "batteryConfig": values["batteryConfig"],
      "lastBattery": values["lastBattery"],
      "dismissedWarnings": values["dismissedWarnings"],
      "ignoredConfigChangeFields": values[BoardConfigChangeNotice.ignoredFieldsSettingKey],
      "topSpeedKmh": values["topSpeedKmh"] ?? defaultTopSpeedKmh,
      "alertPresetsOnboarded": values["alertPresetsOnboarded"] ?? false,
      "legalMode": values["legalMode"] ?? ["enabled": false],
      "link": link,
      "deletedAt": row["deleted_at"] as Int64?,
    ]
  }

  private static func composeBoard(_ board: PersistedBoard, settings: [(String, String)]) -> [String: Any?] {
    var values: [String: Any] = [:]
    for (key, json) in settings {
      if let decoded = decodeBoardSetting(key: key, json: json) { values[key] = decoded }
    }
    let link = BoardLinkPersistence.compose(bleId: board.bleId, values: values)
    return [
      "id": board.id, "name": board.name, "description": values["description"],
      "personalization": values["personalization"],
      "createdAt": board.createdAt, "batteryConfig": values["batteryConfig"],
      "lastBattery": values["lastBattery"], "dismissedWarnings": values["dismissedWarnings"],
      "ignoredConfigChangeFields": values[BoardConfigChangeNotice.ignoredFieldsSettingKey],
      "topSpeedKmh": values["topSpeedKmh"] ?? defaultTopSpeedKmh,
      "alertPresetsOnboarded": values["alertPresetsOnboarded"] ?? false,
      "legalMode": values["legalMode"] ?? ["enabled": false],
      "link": link, "deletedAt": board.deletedAt,
    ]
  }

  private static func decodeBoardSetting(key: String, json: String) -> Any? {
    guard let raw = decodeJson(json) else { return nil }
    switch key {
    case "description":
      return raw as? String
    case "personalization":
      return normalizePersonalization(raw)
    case "batteryConfig":
      return normalizeBatteryConfig(raw)
    case "hasBms":
      return raw as? Bool
    case "linkVersion":
      return intValue(raw)
    case "vescFirmwareVersion", "refloatVersion", "refloatBaseVersion", "transport":
      return raw as? String
    case "lastBattery":
      return decodeLastBattery(raw)
    case "dismissedWarnings", BoardConfigChangeNotice.ignoredFieldsSettingKey:
      return normalizeStringList(raw)
    case "topSpeedKmh":
      return topSpeedKmh(raw)
    case "alertPresetsOnboarded":
      return raw as? Bool
    case "legalMode":
      return normalizeLegalMode(raw)
    default:
      return nil
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `normalizePersonalization`
  /// @parity /modules/vescape-core/src/index.ts `Board.personalization`
  private static func normalizePersonalization(_ raw: Any?) -> [String: String]? {
    guard let map = raw as? [String: Any],
          let railId = map["railId"] as? String, !railId.isEmpty,
          let railColorId = map["railColorId"] as? String, !railColorId.isEmpty
    else { return nil }
    return ["railId": railId, "railColorId": railColorId]
  }

  private static func normalizeLegalMode(_ raw: Any?) -> [String: Bool]? {
    guard let map = raw as? [String: Any], let enabled = map["enabled"] as? Bool else { return nil }
    return ["enabled": enabled]
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `normalizeStringList`
  private static func normalizeStringList(_ raw: Any?) -> [String]? {
    guard let list = raw as? [Any] else { return nil }
    var seen = Set<String>()
    let items = list.compactMap { $0 as? String }.filter { !$0.isEmpty && seen.insert($0).inserted }
    return items.isEmpty ? nil : items
  }

  private static func decodeLastBattery(_ raw: Any?) -> [String: Any?]? {
    guard
      let map = raw as? [String: Any],
      let percent = doubleValue(map["percent"]),
      let at = longValue(map["at"])
    else { return nil }
    return ["percent": percent, "voltage": doubleValue(map["voltage"]), "at": at]
  }

  func getAlertRules(_ boardId: String) throws -> [[String: Any?]] {
    guard let writer else { throw StorageUnavailable.databaseNotOpen }
    return try AlertRulePersistence(writer: writer).rules(boardId: boardId, reportPresetFailure: Self.reportPresetFailure).map { row in
        [
          "boardId": row.boardId, "id": row.id, "controlId": row.controlId,
          "threshold": row.threshold, "thresholdMax": row.thresholdMax,
          "thresholdRule": row.thresholdKind == "config-relative" ? [
            "kind": "config-relative", "fieldId": row.configFieldId,
            "thresholdOffset": row.thresholdOffset, "thresholdMaxOffset": row.thresholdMaxOffset
          ] : ["kind": "fixed"],
          "enabled": row.enabled, "spec": row.spec, "createdAt": row.createdAt,
          "repeatEverySeconds": row.repeatEverySeconds,
        ]
    }
  }

  private static func reportPresetFailure(_ error: Error) {
    RecordingStorageFailure.reportRead(operation: "alert_preset_expand", error: error)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getAlertPresets`
  func getAlertPresets(_ boardId: String) throws -> [String: String] {
    guard let writer else { throw StorageUnavailable.databaseNotOpen }
    return try AlertRulePersistence(writer: writer).presets(boardId: boardId)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getEnabledAlertRuleEntities`
  func getEnabledAlertRules(_ boardId: String) throws -> [AlertRule] {
    guard let writer else { throw StorageUnavailable.databaseNotOpen }
    return try AlertRulePersistence(writer: writer).rules(boardId: boardId, reportPresetFailure: Self.reportPresetFailure).filter(\.enabled).map { row in
      AlertRule(
        boardId: row.boardId,
        id: row.id,
        controlId: row.controlId,
        threshold: row.threshold,
        thresholdMax: row.thresholdMax,
        thresholdKind: row.thresholdKind,
        configFieldId: row.configFieldId,
        thresholdOffset: row.thresholdOffset,
        thresholdMaxOffset: row.thresholdMaxOffset,
        enabled: row.enabled,
        spec: row.spec,
        createdAt: row.createdAt,
        repeatEverySeconds: row.repeatEverySeconds
      )
    }
  }

  private static func initialAlertRows(boardId: String, _ alerts: [String: Any], now createdAt: Int64) throws -> [PersistedAlertRule] {
    let presets = try (alerts["presets"] as? [String: Any] ?? [:]).compactMap { metric, spec in
      guard let spec = spec as? String else { throw AlertPresetPersistence.InvalidPreset.invalidIntent }
      return try AlertPresetPersistence.presetRow(boardId: boardId, metric: metric, spec: spec, createdAt: createdAt)
    }
    let rules = try (alerts["rules"] as? [[String: Any?]] ?? []).map { raw in
      let rule = try alertRuleRecord(raw, now: createdAt)
      try AlertRulePersistence.requireRiderRule(rule)
      guard rule.boardId == boardId else { throw InvalidInput.alertRuleIdentity }
      return rule
    }
    return presets + rules
  }

  func upsertAlertRule(_ rule: [String: Any?]) throws {
    guard let writer else { throw StorageUnavailable.databaseNotOpen }
    try AlertRulePersistence(writer: writer).save(try Self.alertRuleRecord(rule, now: nowMs()))
  }

  private static func alertRuleRecord(_ rule: [String: Any?], now: Int64) throws -> PersistedAlertRule {
    guard
      let boardId = rule["boardId"] as? String,
      let id = rule["id"] as? String,
      let controlId = rule["controlId"] as? String
    else { throw InvalidInput.alertRuleIdentity }
    let threshold = Self.doubleValue(rule["threshold"] ?? nil) ?? 0
    let thresholdMax = Self.doubleValue(rule["thresholdMax"] ?? nil)
    let enabled = (rule["enabled"] as? Bool) ?? false
    let spec = rule["spec"] as? String ?? "default"
    let createdAt = Self.longValue(rule["createdAt"] ?? nil) ?? now
    let repeatEverySeconds = normalizedAlertRepeatSeconds(Self.doubleValue(rule["repeatEverySeconds"] ?? nil))
    let thresholdRule = rule["thresholdRule"] as? [String: Any]
    let thresholdKind = thresholdRule?["kind"] as? String ?? "fixed"
    let configFieldId = thresholdRule?["fieldId"] as? String
    let thresholdOffset = Self.doubleValue(thresholdRule?["thresholdOffset"])
    let thresholdMaxOffset = Self.doubleValue(thresholdRule?["thresholdMaxOffset"])
    return PersistedAlertRule(boardId: boardId, id: id, controlId: controlId, threshold: threshold, thresholdMax: thresholdMax, enabled: enabled, spec: spec, createdAt: createdAt, repeatEverySeconds: repeatEverySeconds, thresholdKind: thresholdKind, configFieldId: configFieldId, thresholdOffset: thresholdOffset, thresholdMaxOffset: thresholdMaxOffset)
  }

  func setAlertRuleEnabled(_ boardId: String, _ id: String, _ enabled: Bool) throws {
    guard let writer else { throw StorageUnavailable.databaseNotOpen }
    try AlertRulePersistence(writer: writer).setEnabled(boardId: boardId, id: id, enabled: enabled)
  }

  func deleteAlertRule(_ boardId: String, _ id: String) throws {
    guard let writer else { throw StorageUnavailable.databaseNotOpen }
    try AlertRulePersistence(writer: writer).delete(boardId: boardId, id: id)
  }

  func getPrivacyZones() throws -> [[String: Any?]] {
    guard let writer else { throw StorageUnavailable.databaseNotOpen }
    return try PrivacyZonePersistence(writer: writer).zones().map { row in
        [
          "id": row.id, "preset": row.preset, "name": row.name, "enabled": row.enabled,
          "centerLatitude": row.centerLatitudeE7.asE7Degrees,
          "centerLongitude": row.centerLongitudeE7.asE7Degrees,
          "radiusMeters": row.radiusMeters, "createdAt": row.createdAt, "updatedAt": row.updatedAt,
        ]
    }
  }

  func upsertPrivacyZone(_ zone: [String: Any?]) throws {
    guard
      let id = zone["id"] as? String,
      let name = zone["name"] as? String,
      let latitude = Self.doubleValue(zone["centerLatitude"] ?? nil),
      let longitude = Self.doubleValue(zone["centerLongitude"] ?? nil),
      let radius = Self.longValue(zone["radiusMeters"] ?? nil)
    else { throw InvalidInput.alertRuleIdentity }
    let preset = zone["preset"] as? String ?? "custom"
    let enabled = (zone["enabled"] as? Bool) ?? false
    let now = nowMs()
    let createdAt = Self.longValue(zone["createdAt"] ?? nil) ?? now
    let updatedAt = Self.longValue(zone["updatedAt"] ?? nil) ?? now
    guard let writer else { throw StorageUnavailable.databaseNotOpen }
    try PrivacyZonePersistence(writer: writer).save(.init(id: id, preset: preset, name: name, enabled: enabled, centerLatitudeE7: latitude.toE7, centerLongitudeE7: longitude.toE7, radiusMeters: radius, createdAt: createdAt, updatedAt: updatedAt))
  }

  func setPrivacyZoneEnabled(_ id: String, _ enabled: Bool) throws {
    let updatedAt = nowMs()
    guard let writer else { throw StorageUnavailable.databaseNotOpen }
    try PrivacyZonePersistence(writer: writer).setEnabled(id: id, enabled: enabled, updatedAt: updatedAt)
  }

  func deletePrivacyZone(_ id: String) throws {
    guard let writer else { throw StorageUnavailable.databaseNotOpen }
    try PrivacyZonePersistence(writer: writer).delete(id: id)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getDirectionPoint`
  static let directionPointLatitudeKey = "directionPointLatitude"
  static let directionPointLongitudeKey = "directionPointLongitude"

  func setDirectionPoint(latitude: Double?, longitude: Double?) throws {
    let updatedAt = nowMs()
    let values = try [latitude, longitude].map { value -> PersistedAppSetting? in
      guard let value else { return nil }
      return PersistedAppSetting(key: "", valueJson: try Self.encodeJson(value), updatedAt: updatedAt)
    }
    let keys = [Self.directionPointLatitudeKey, Self.directionPointLongitudeKey]
    let keyed = zip(values, keys).map { setting, key in
      setting.map { PersistedAppSetting(key: key, valueJson: $0.valueJson, updatedAt: $0.updatedAt) }
    }
    try boardSettingsPersistence().replaceSettings(keyed, keys: keys)
    notifyDataChanged(.settings)
  }

  func getDirectionPoint() throws -> (latitude: Double, longitude: Double)? {
    let settings = try getSettings()
    guard
      let latitude = Self.doubleValue(settings[Self.directionPointLatitudeKey] ?? nil),
      let longitude = Self.doubleValue(settings[Self.directionPointLongitudeKey] ?? nil)
    else { return nil }
    return (latitude, longitude)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getNavigationPath`
  static let navigationPathKey = "navigationPath"

  func getNavigationPath() throws -> String? {
    guard let row = try boardSettingsPersistence().setting(Self.navigationPathKey) else { return nil }
    return try Self.decodeStoredString(row.valueJson)
  }

  func setNavigationPath(_ json: String?) throws {
    guard let json else { try boardSettingsPersistence().deleteSetting(Self.navigationPathKey); return }
    let encoded = try Self.encodeJson(json)
    try boardSettingsPersistence().saveSetting(.init(key: Self.navigationPathKey, valueJson: encoded, updatedAt: nowMs()))
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getNavigationProfile`
  static let navigationProfileKey = "navigationProfile"

  func getNavigationProfile() throws -> String? {
    guard let row = try boardSettingsPersistence().setting(Self.navigationProfileKey) else { return nil }
    return try Self.decodeStoredString(row.valueJson)
  }

  func setNavigationProfile(_ profile: String) throws {
    let encoded = try Self.encodeJson(profile)
    try boardSettingsPersistence().saveSetting(.init(key: Self.navigationProfileKey, valueJson: encoded, updatedAt: nowMs()))
  }

  private static func decodeStoredString(_ json: String) throws -> String {
    let decoded = try JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed])
    guard let value = decoded as? String else { throw CocoaError(.coderInvalidValue) }
    return value
  }

  func getSettings() throws -> [String: Any?] {
    // intentional-suppression: invalid unit JSON is deleted and reported as app_setting_invalid below.
    if let row = try boardSettingsPersistence().setting("distanceUnit"),
      validDistanceUnit(try? Self.decodeStoredString(row.valueJson)) == nil {
      try boardSettingsPersistence().deleteSetting("distanceUnit")
      TelemetryRepository.shared.recordDiagnosticEvent(eventName: "app_setting_invalid", properties: ["key": "distanceUnit"])
    }
    var merged = try boardSettingsPersistence().settings(defaults: Self.defaultSettings)
    merged.removeValue(forKey: Self.navigationPathKey)
    merged.removeValue(forKey: Self.navigationProfileKey)
    for key in merged.keys where key.hasPrefix(MAINTENANCE_JOB_KEY_PREFIX) { merged.removeValue(forKey: key) }
    if merged["movingSpeedThresholdKmh"] == nil {
      if let legacy = merged["avgSpeedCutoffKmh"] ?? merged["movingAvgSpeedThresholdKmh"] {
        merged["movingSpeedThresholdKmh"] = legacy
      }
    }
    return Self.normalizeSettings(merged)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `updateLastGpsLocation`
  func updateLastGpsLocation(latitude: Double, longitude: Double) throws {
    let lat = try Self.encodeJson(latitude)
    let lon = try Self.encodeJson(longitude)
    let updatedAt = nowMs()
    try boardSettingsPersistence().saveSettings([
      PersistedAppSetting(key: "lastGpsLatitude", valueJson: lat, updatedAt: updatedAt),
      PersistedAppSetting(key: "lastGpsLongitude", valueJson: lon, updatedAt: updatedAt),
    ])
    notifyDataChanged(.settings)
  }

  func updateSetting(_ key: String, rawValue: Any?) throws {
    guard
      key != "legalPolicy", key != "legalMode",
      key != Self.navigationPathKey, key != Self.navigationProfileKey,
      !key.hasPrefix(MAINTENANCE_JOB_KEY_PREFIX)
    else { return }
    if key == "distanceUnit" {
      let units = rawValue == nil || rawValue is NSNull ? "km" : validDistanceUnit(rawValue)
      guard let units else { throw CocoaError(.coderInvalidValue) }
      try boardSettingsPersistence().updateDistanceUnit(units)
      notifyDataChanged(.alerts)
      notifyDataChanged(.settings)
      return
    }
    let updatedAt = nowMs()
    guard let rawValue, !(rawValue is NSNull) else {
      try boardSettingsPersistence().deleteSetting(key)
      notifyDataChanged(.settings)
      return
    }
    let value: Any
    if key == "liveHistoryLimit" {
      guard let minutes = Self.liveHistoryLimitMinutes(rawValue) else { return }
      value = minutes
    } else if key == "satelliteImageryOpacity" {
      guard let opacity = Self.satelliteImageryOpacity(rawValue) else { return }
      value = opacity
    } else if key == "satelliteMapImageryOpacity" {
      guard let opacity = Self.satelliteImageryOpacity(rawValue) else { return }
      value = opacity
    } else if key == "satelliteImagerySaturation" {
      guard let saturation = Self.satelliteImagerySaturation(rawValue) else { return }
      value = saturation
    } else if key == "soundPack" {
      guard let pack = rawValue as? String, effectsPackIds.contains(pack) else { return }
      value = pack
    } else if key == "audioSource" {
      guard let source = Self.audioSource(rawValue) else { return }
      value = source
    } else if key == "voice" {
      guard let voice = Self.voice(rawValue) else { return }
      value = voice
    } else if key == "voiceLevel" {
      guard let level = Self.voiceLevel(rawValue) else { return }
      value = level
    } else if key == "timeFormat" {
      guard let format = validTimeFormat(rawValue) else {
        throw CocoaError(.coderInvalidValue)
      }
      value = format
    } else if key == "temperatureUnit" {
      guard let unit = validTemperatureUnit(rawValue) else { return }
      value = unit
    } else if key == "weatherRainAlertLevel" || key == "weatherWindAlertLevel" {
      guard let level = Self.weatherAlertLevel(rawValue) else { return }
      value = level
    } else if key == "themeMode" {
      guard let mode = Self.themeMode(rawValue) else { return }
      value = mode
    } else if key == "boardWarningsEnabled" {
      guard let flag = rawValue as? Bool else { return }
      value = flag
    } else if key == "vescFaultCollectionEnabled" {
      guard let flag = rawValue as? Bool else { return }
      value = flag
    } else if key == "navigationRerouteDistanceMeters" {
      guard let distance = Self.navigationRerouteDistanceMeters(rawValue) else {
        throw NSError(domain: "AppSettings", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid navigationRerouteDistanceMeters"])
      }
      value = distance
    } else if key == "boardMoveStrengthPercent" {
      guard let percent = Self.boardMoveStrengthPercent(rawValue) else { return }
      value = percent
    } else if key == "wearPushRateHz" {
      guard let hz = Self.wearPushRateHz(rawValue) else { return }
      value = hz
    } else if key == "wearTiltRatePercent" {
      guard let percent = Self.wearTiltRatePercent(rawValue) else { return }
      value = percent
    } else if key == "wearMapGaugesPercent" {
      guard let percent = WatchMapGauges.percent(rawValue) else { return }
      value = percent
    } else if key == "wearAutoLaunchOnConnect" || key == "wearNavArrowEnabled" || key == "wearTelemetryTrailEnabled" || key == "wearTelemetryGroupEnabled" || key == "wearTelemetryRouteEnabled" || key == "wearStreetMapEnabled" {
      guard let flag = rawValue as? Bool else { return }
      value = flag
    } else if key == "rideSplitGapMinutes" {
      guard let minutes = Self.rideSplitGapMinutes(rawValue) else { return }
      value = minutes
    } else if key == "dismissedCommunityMessageIds" {
      guard let ids = Self.dismissedCommunityMessageIds(rawValue) else { return }
      value = ids
    } else {
      value = rawValue
    }
    let json = try Self.encodeJson(value)
    try boardSettingsPersistence().saveSetting(PersistedAppSetting(key: key, valueJson: json, updatedAt: updatedAt))
    notifyDataChanged(.settings)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `updateLegalPolicy`
  func updateLegalPolicy(jurisdictionCode: String?) throws {
    let code = jurisdictionCode?.trimmingCharacters(in: .whitespaces).uppercased()
    let value = code.flatMap { $0.count == 2 ? ["jurisdictionCode": $0] : nil }
    guard let value else {
      try boardSettingsPersistence().deleteSetting("legalPolicy")
      notifyDataChanged(.settings)
      return
    }
    let json = try Self.encodeJson(value)
    try boardSettingsPersistence().saveSetting(PersistedAppSetting(key: "legalPolicy", valueJson: json, updatedAt: nowMs()))
    notifyDataChanged(.settings)
  }

  /// @parity /modules/vescape-core/src/index.ts `AppSettings`
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `AppSettings`
  static let defaultSettings: [String: Any] = [
    "liveHistoryLimit": 5,
    "autoConnect": true,
    "autoRecording": true,
    "companionPresenceEnabled": false,
    "boardWarningsEnabled": true,
    "vescFaultCollectionEnabled": true,
    "companionPresenceCooldownMinutes": 60,
    // @platform-diff Auto close is Android-only behavior (iOS forbids programmatic app exit);
    // the keys exist here only so getSettings() returns the full settings shape.
    "autoCloseEnabled": false,
    "autoCloseDelayMinutes": 15,
    "selectedBoardId": NSNull(),
    "lastGpsLatitude": NSNull(),
    "lastGpsLongitude": NSNull(),
    "directionPointLatitude": NSNull(),
    "directionPointLongitude": NSNull(),
    "legalPolicy": NSNull(),
    "movingSpeedThresholdKmh": 3,
    "rideSplitGapMinutes": DEFAULT_RIDE_SPLIT_GAP_MINUTES,
    "distanceUnit": "km",
    "temperatureUnit": "celsius",
    "timeFormat": "24h",
    "themeMode": "system",
    "satelliteOverlayEnabled": true,
    "satelliteImageryOpacity": 0.2,
    "satelliteMapImageryOpacity": 1.0,
    "satelliteImagerySaturation": -0.35,
    "navigationRerouteDistanceMeters": NavigationController.defaultRerouteDistanceMeters,
    "hideTelemetryMapDetails": true,
    "showHistoryMapMarkers": false,
    "telemetryPollRateHz": 20,
    "wearPushRateHz": defaultWearPushRateHz,
    // @platform-diff Opening the Mirror when a board connects is Android-only: watchOS has no
    // public API for an iPhone app to launch its watch companion (see docs/watchos.md). The key
    // exists here only so getSettings() returns the full settings shape.
    "wearAutoLaunchOnConnect": true,
    "wearNavArrowEnabled": false,
    "wearTelemetryTrailEnabled": true,
    "wearTelemetryGroupEnabled": true,
    "wearTelemetryRouteEnabled": true,
    "wearStreetMapEnabled": true,
    "wearMapGaugesPercent": WatchMapGauges.defaultPercent,
    "wearTiltRatePercent": 20,
    "boardMoveStrengthPercent": 60,
    "connectionSoundsEnabled": true,
    "soundPack": effectsPackFallback,
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `AppSettings`
    // @parity /modules/vescape-core/src/index.ts `AppSettings`
    // @platform-diff iOS has no Android alarm/media stream selection; stored for shared settings and backups.
    "audioSource": "alarm",
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `AppSettings`
    "voice": voiceMatching,
    "voiceLevel": voiceLevelDefault,
    "weatherRainAlertLevel": weatherAlertLevelDefault,
    "weatherWindAlertLevel": weatherAlertLevelDefault,
    "historyMetricGradientsEnabled": true,
    "historyMetricHotRanges": [
      "speed": ["start": 30, "end": 40],
      "duty": ["start": 60, "end": 80],
      "tempMotor": ["start": 70, "end": 90],
      "tempController": ["start": 60, "end": 80],
      "motorCurrent": ["start": 35, "end": 55],
      "batteryCurrent": ["start": 25, "end": 45],
    ],
    "dismissedCommunityMessageIds": [String](),
  ]

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `validRerouteDistanceMeters`
  static func audioSource(_ value: Any?) -> String? {
    guard let source = value as? String, source == "alarm" || source == "media" else { return nil }
    return source
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `validRerouteDistanceMeters`
  static func navigationRerouteDistanceMeters(_ value: Any?) -> Double? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    let distance = number.doubleValue
    return distance.isFinite && NavigationController.rerouteDistanceRange.contains(distance) ? distance : nil
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `validVoice`
  static func voice(_ value: Any?) -> String? {
    guard let raw = value as? String else { return nil }
    let voice = renamedVoicePackIds[raw] ?? raw
    guard voice == voiceMatching || voicePackIds.contains(voice) else { return nil }
    return voice
  }

  static func voiceLevel(_ value: Any?) -> String? {
    guard let level = value as? String, voiceLevels.contains(level) else { return nil }
    return level
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `validWeatherAlertLevel`
  static func weatherAlertLevel(_ value: Any?) -> String? {
    guard let level = value as? String, weatherAlertLevelSettings.contains(level) else { return nil }
    return level
  }

  static func normalizeSettings(_ settings: [String: Any]) -> [String: Any] {
    var normalized = settings
    normalized["navigationRerouteDistanceMeters"] = navigationRerouteDistanceMeters(settings["navigationRerouteDistanceMeters"])
      ?? NavigationController.defaultRerouteDistanceMeters
    normalized["liveHistoryLimit"] =
      liveHistoryLimitMinutes(settings["liveHistoryLimit"]) ?? defaultSettings["liveHistoryLimit"]
    normalized["distanceUnit"] = validDistanceUnit(settings["distanceUnit"]) ?? "km"
    normalized["temperatureUnit"] = validTemperatureUnit(settings["temperatureUnit"]) ?? "celsius"
    normalized["timeFormat"] = validTimeFormat(settings["timeFormat"]) ?? "24h"
    normalized["themeMode"] = themeMode(settings["themeMode"]) ?? defaultSettings["themeMode"]
    normalized["audioSource"] = audioSource(settings["audioSource"]) ?? "alarm"
    normalized["voice"] = voice(settings["voice"]) ?? voiceMatching
    normalized["voiceLevel"] = voiceLevel(settings["voiceLevel"]) ?? voiceLevelDefault
    normalized["weatherRainAlertLevel"] = weatherAlertLevel(settings["weatherRainAlertLevel"]) ?? weatherAlertLevelDefault
    normalized["weatherWindAlertLevel"] = weatherAlertLevel(settings["weatherWindAlertLevel"]) ?? weatherAlertLevelDefault
    let saved = settings["soundPack"] as? String ?? effectsPackFallback
    let pack = renamedEffectsPackIds[saved] ?? saved
    MySounds.adoptLegacyPack(saved)
    normalized["soundPack"] = effectsPackIds.contains(pack) ? pack : effectsPackFallback
    normalized["satelliteImageryOpacity"] =
      satelliteImageryOpacity(settings["satelliteImageryOpacity"]) ?? defaultSettings["satelliteImageryOpacity"]
    normalized["satelliteMapImageryOpacity"] =
      satelliteImageryOpacity(settings["satelliteMapImageryOpacity"]) ?? defaultSettings["satelliteMapImageryOpacity"]
    normalized["satelliteImagerySaturation"] =
      satelliteImagerySaturation(settings["satelliteImagerySaturation"]) ?? defaultSettings["satelliteImagerySaturation"]
    normalized["boardMoveStrengthPercent"] =
      boardMoveStrengthPercent(settings["boardMoveStrengthPercent"]) ?? defaultSettings["boardMoveStrengthPercent"]
    normalized["wearPushRateHz"] =
      wearPushRateHz(settings["wearPushRateHz"]) ?? defaultSettings["wearPushRateHz"]
    normalized["wearTiltRatePercent"] =
      wearTiltRatePercent(settings["wearTiltRatePercent"]) ?? defaultSettings["wearTiltRatePercent"]
    normalized["wearMapGaugesPercent"] =
      WatchMapGauges.percent(settings["wearMapGaugesPercent"]) ?? defaultSettings["wearMapGaugesPercent"]
    normalized["rideSplitGapMinutes"] =
      rideSplitGapMinutes(settings["rideSplitGapMinutes"]) ?? defaultSettings["rideSplitGapMinutes"]
    normalized["legalPolicy"] = normalizeLegalPolicy(settings["legalPolicy"]) ?? NSNull()
    normalized["dismissedCommunityMessageIds"] =
      dismissedCommunityMessageIds(settings["dismissedCommunityMessageIds"]) ?? [String]()
    normalized["legalPolicy"] = normalizeLegalPolicy(settings["legalPolicy"]) ?? NSNull()
    return normalized
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `wearPushRateHz`
  static let defaultWearPushRateHz = 4

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `validWearPushRateHz`
  static func wearPushRateHz(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, !(value is Bool) else { return nil }
    return min(20, max(1, number.intValue))
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `validWearTiltRatePercent`
  static func wearTiltRatePercent(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, !(value is Bool) else { return nil }
    return min(100, max(1, number.intValue))
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `validBoardMoveStrengthPercent`
  static func boardMoveStrengthPercent(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, !(value is Bool) else { return nil }
    return min(100, max(10, number.intValue))
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `validRideSplitGapMinutes`
  static func rideSplitGapMinutes(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, !(value is Bool) else { return nil }
    return min(1440, max(1, number.intValue))
  }

  static func dismissedCommunityMessageIds(_ value: Any?) -> [String]? {
    guard let array = value as? [Any] else { return nil }
    var seen = Set<String>()
    var result: [String] = []
    for entry in array {
      guard let id = entry as? String, !id.isEmpty, seen.insert(id).inserted else { continue }
      result.append(id)
    }
    return result
  }

  private static func normalizeLegalPolicy(_ raw: Any?) -> [String: String]? {
    guard
      let value = raw as? [String: Any],
      let rawCode = value["jurisdictionCode"] as? String
    else { return nil }
    let code = rawCode.trimmingCharacters(in: .whitespaces).uppercased()
    return code.count == 2 ? ["jurisdictionCode": code] : nil
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `DEFAULT_TOP_SPEED_KMH`
  static let defaultTopSpeedKmh: Double = 50

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `validTopSpeedKmh`
  static func topSpeedKmh(_ value: Any?) -> Double? {
    guard let topSpeed = doubleValue(value), topSpeed.isFinite else { return nil }
    return min(150, max(5, topSpeed))
  }

  static func satelliteImageryOpacity(_ value: Any?) -> Double? {
    guard let opacity = doubleValue(value), opacity.isFinite else { return nil }
    return min(1, max(0.1, opacity))
  }

  static func satelliteImagerySaturation(_ value: Any?) -> Double? {
    guard let saturation = doubleValue(value), saturation.isFinite else { return nil }
    return min(1, max(-1, saturation))
  }

  static func themeMode(_ value: Any?) -> String? {
    guard let mode = value as? String else { return nil }
    return ["system", "light", "dark", "sun"].contains(mode) ? mode : nil
  }

  static func liveHistoryLimitMinutes(_ value: Any?) -> Int? {
    guard let minutes = intValue(value) else { return nil }
    return min(50, max(1, minutes))
  }

  static func normalizeBatteryConfig(_ raw: Any?) -> [String: Any]? {
    guard let config = raw as? [String: Any], let mode = config["mode"] as? String else { return nil }
    switch mode {
    case "preset":
      guard
        let cellPresetId = config["cellPresetId"] as? String, !cellPresetId.isEmpty,
        let seriesCount = intValue(config["seriesCount"]), seriesCount > 0,
        let parallelCount = intValue(config["parallelCount"]), parallelCount > 0
      else { return nil }
      return [
        "mode": "preset",
        "cellPresetId": cellPresetId,
        "seriesCount": seriesCount,
        "parallelCount": parallelCount,
      ]
    case "manual":
      guard
        let minVoltage = doubleValue(config["minVoltage"]),
        let maxVoltage = doubleValue(config["maxVoltage"]),
        minVoltage.isFinite, maxVoltage.isFinite, maxVoltage > minVoltage
      else { return nil }
      return ["mode": "manual", "minVoltage": minVoltage, "maxVoltage": maxVoltage]
    default:
      return nil
    }
  }

  static func intValue(_ raw: Any?) -> Int? {
    if let value = raw as? Int { return value }
    if let value = raw as? NSNumber { return value.intValue }
    return nil
  }

  static func doubleValue(_ raw: Any?) -> Double? {
    if let value = raw as? Double { return value }
    if let value = raw as? NSNumber { return value.doubleValue }
    return nil
  }

  static func longValue(_ raw: Any?) -> Int64? {
    if let value = raw as? Int64 { return value }
    if let value = raw as? Int { return Int64(value) }
    if let value = raw as? NSNumber { return value.int64Value }
    return nil
  }

  static func optionalString(_ raw: Any?) -> String? {
    guard let value = raw as? String else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private static func encodeJson(_ value: Any) throws -> String {
    guard JSONSerialization.isValidJSONObject([value]) else {
      throw CocoaError(.propertyListWriteInvalid)
    }
    let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
    guard let json = String(data: data, encoding: .utf8) else {
      throw CocoaError(.fileWriteInapplicableStringEncoding)
    }
    return json
  }

  private static func decodeJson(_ text: String) -> Any? {
    do {
      guard let data = text.data(using: .utf8) else { throw AppDataJsonDecodeError.invalidEncoding }
      let object = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
      return object is NSNull ? nil : object
    } catch {
      UnexpectedNativeError.report(operation: "app_data_json_decode", category: "serialization", error: error)
      return nil
    }
  }
}

private enum AppDataJsonDecodeError: Error { case invalidEncoding }

private extension Int64 {
  var asE7Degrees: Double { Double(self) / 10_000_000.0 }
}

private extension Double {
  var toE7: Int64 { Int64(self * 10_000_000.0) }
}
