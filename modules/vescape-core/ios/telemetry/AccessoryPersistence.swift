import Foundation
import GRDB

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `SavedAccessoryEntity`
/// @parity /modules/vescape-core/src/index.ts `SavedAccessory`
struct SavedAccessory: Equatable {
  let accessoryId: String
  let name: String
  let firmwareVersion: String
  let protocolVersion: Int?
  let deviceId: String?
  let capabilitiesJson: String
  let enrolledAt: Int64
  let lastConnectedAt: Int64?
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `AccessoryGroundClearanceEntity`
/// @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceCalibration`
struct SavedGroundClearance: Equatable {
  let accessoryId: String
  let capabilityId: String
  let nearCm: Double
  let farCm: Double
  let direction: String
  let strengthPercent: Int
  let updatedAt: Int64
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AccessoryPersistence.kt
struct AccessoryStore {
  private struct WriterUnavailable: Error {}
  private let resolveWriter: () -> DatabaseWriter?

  static let shared = AccessoryStore { VescapeDatabase.pool }

  init(_ resolveWriter: @escaping () -> DatabaseWriter?) { self.resolveWriter = resolveWriter }
  init(dbWriter: DatabaseWriter) { self.resolveWriter = { dbWriter } }

  private struct Record: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "accessories"
    let accessoryId: String
    let name: String
    let firmwareVersion: String
    let protocolVersion: Int?
    let deviceId: String?
    let capabilitiesJson: String
    let enrolledAt: Int64
    let lastConnectedAt: Int64?

    enum CodingKeys: String, CodingKey {
      case accessoryId = "accessory_id"
      case name
      case firmwareVersion = "firmware_version"
      case protocolVersion = "protocol_version"
      case deviceId = "device_id"
      case capabilitiesJson = "capabilities_json"
      case enrolledAt = "enrolled_at"
      case lastConnectedAt = "last_connected_at"
    }

    init(_ accessory: SavedAccessory) {
      accessoryId = accessory.accessoryId
      name = accessory.name
      firmwareVersion = accessory.firmwareVersion
      protocolVersion = accessory.protocolVersion
      deviceId = accessory.deviceId
      capabilitiesJson = accessory.capabilitiesJson
      enrolledAt = accessory.enrolledAt
      lastConnectedAt = accessory.lastConnectedAt
    }

    var accessory: SavedAccessory {
      .init(
        accessoryId: accessoryId, name: name, firmwareVersion: firmwareVersion,
        protocolVersion: protocolVersion, deviceId: deviceId,
        capabilitiesJson: capabilitiesJson, enrolledAt: enrolledAt,
        lastConnectedAt: lastConnectedAt)
    }
  }

  private struct GroundClearanceRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "accessory_ground_clearance"
    let accessoryId: String
    let capabilityId: String
    let nearCm: Double
    let farCm: Double
    let direction: String
    let strengthPercent: Int
    let updatedAt: Int64

    enum CodingKeys: String, CodingKey {
      case accessoryId = "accessory_id"
      case capabilityId = "capability_id"
      case nearCm = "near_cm"
      case farCm = "far_cm"
      case direction
      case strengthPercent = "strength_percent"
      case updatedAt = "updated_at"
    }

    init(_ calibration: SavedGroundClearance) {
      accessoryId = calibration.accessoryId
      capabilityId = calibration.capabilityId
      nearCm = calibration.nearCm
      farCm = calibration.farCm
      direction = calibration.direction
      strengthPercent = calibration.strengthPercent
      updatedAt = calibration.updatedAt
    }

    var calibration: SavedGroundClearance {
      .init(
        accessoryId: accessoryId, capabilityId: capabilityId, nearCm: nearCm, farCm: farCm,
        direction: direction, strengthPercent: strengthPercent, updatedAt: updatedAt)
    }
  }

  static func createTables(_ db: Database) throws {
    try PersistenceSchema.createAccessories(db)
    try PersistenceSchema.createAccessoryGroundClearance(db)
    try PersistenceSchema.createAccessoryBrakeLight(db)
    try PersistenceSchema.createAccessoryCapabilitySettings(db)
    if try !db.columns(in: "accessory_capability_settings").contains(where: { $0.name == "sampling_rate_hz" }) {
      try db.execute(sql: "ALTER TABLE accessory_capability_settings ADD COLUMN sampling_rate_hz REAL")
    }
  }

  private func writer() throws -> DatabaseWriter {
    guard let writer = resolveWriter() else { throw WriterUnavailable() }
    return writer
  }

  func accessories() throws -> [SavedAccessory] {
    try writer().read { db in
      try Record.order(Column("enrolled_at")).fetchAll(db).map(\.accessory)
    }
  }

  func accessory(_ accessoryId: String) throws -> SavedAccessory? {
    try writer().read { db in
      try Record.fetchOne(db, key: ["accessory_id": accessoryId])?.accessory
    }
  }

  @discardableResult
  func upsert(_ accessory: SavedAccessory) throws -> SavedAccessory {
    try writer().write { db in
      let existing = try Record.fetchOne(db, key: ["accessory_id": accessory.accessoryId])
      let row = SavedAccessory(
        accessoryId: accessory.accessoryId, name: accessory.name,
        firmwareVersion: accessory.firmwareVersion, protocolVersion: accessory.protocolVersion,
        deviceId: accessory.deviceId, capabilitiesJson: accessory.capabilitiesJson,
        enrolledAt: existing?.enrolledAt ?? accessory.enrolledAt,
        lastConnectedAt: accessory.lastConnectedAt)
      try Record(row).save(db)
      return row
    }
  }

  @discardableResult
  func forget(_ accessoryId: String) throws -> Bool {
    try writer().write { db in
      try db.execute(
        sql: "DELETE FROM accessory_ground_clearance WHERE accessory_id = ?",
        arguments: [accessoryId])
      try db.execute(sql: "DELETE FROM accessory_brake_light WHERE accessory_id = ?", arguments: [accessoryId])
      try db.execute(sql: "DELETE FROM accessory_capability_settings WHERE accessory_id = ?", arguments: [accessoryId])
      return try Record.deleteOne(db, key: ["accessory_id": accessoryId])
    }
  }

  @discardableResult
  func adoptCapabilities(_ accessoryId: String, capabilitiesJson: String) throws -> Bool {
    try writer().write { db in
      try db.execute(
        sql: "UPDATE accessories SET capabilities_json = ? WHERE accessory_id = ?",
        arguments: [capabilitiesJson, accessoryId])
      return db.changesCount > 0
    }
  }

  func brakeLights() throws -> [SavedBrakeLight] {
    try writer().read { db in try SavedBrakeLight.order(Column("accessory_id"), Column("capability_id")).fetchAll(db) }
  }

  func capabilitySettings() throws -> [SavedAccessoryCapabilitySettings] {
    try writer().read { db in
      try SavedAccessoryCapabilitySettings.order(Column("accessory_id"), Column("capability_id")).fetchAll(db)
    }
  }

  func saveCapabilitySettings(_ settings: SavedAccessoryCapabilitySettings) throws {
    try writer().write { db in
      guard try Record.fetchOne(db, key: ["accessory_id": settings.accessoryId]) != nil else { throw WriterUnavailable() }
      try settings.save(db)
    }
  }

  func saveBrakeLight(_ settings: SavedBrakeLight) throws {
    try writer().write { db in
      guard try Record.fetchOne(db, key: ["accessory_id": settings.accessoryId]) != nil else { throw WriterUnavailable() }
      try settings.save(db)
    }
  }

  func groundClearances() throws -> [SavedGroundClearance] {
    try writer().read { db in
      try GroundClearanceRecord
        .order(Column("accessory_id"), Column("capability_id"))
        .fetchAll(db).map(\.calibration)
    }
  }

  func groundClearance(_ accessoryId: String, _ capabilityId: String) throws -> SavedGroundClearance?
  {
    try writer().read { db in
      try GroundClearanceRecord.fetchOne(
        db, key: ["accessory_id": accessoryId, "capability_id": capabilityId])?.calibration
    }
  }

  func saveGroundClearance(_ calibration: SavedGroundClearance) throws {
    try writer().write { db in try GroundClearanceRecord(calibration).save(db) }
  }

  @discardableResult
  func clearGroundClearance(_ accessoryId: String, _ capabilityId: String) throws -> Bool {
    try writer().write { db in
      try GroundClearanceRecord.deleteOne(
        db, key: ["accessory_id": accessoryId, "capability_id": capabilityId])
    }
  }

  @discardableResult
  func revalidate(_ accessory: SavedAccessory) throws -> Bool {
    try writer().write { db in
      try db.execute(
        sql: "UPDATE accessories SET name = ?, firmware_version = ?, protocol_version = ?, device_id = ?, last_connected_at = ? WHERE accessory_id = ?",
        arguments: [
          accessory.name, accessory.firmwareVersion, accessory.protocolVersion,
          accessory.deviceId, accessory.lastConnectedAt, accessory.accessoryId,
        ])
      return db.changesCount > 0
    }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `AccessoryBrakeLightEntity`
struct SavedBrakeLight: Codable, FetchableRecord, PersistableRecord, Equatable {
  static let databaseTableName = "accessory_brake_light"
  let accessoryId: String
  let capabilityId: String
  let sensitivity: Int
  let parked: String
  enum CodingKeys: String, CodingKey {
    case accessoryId = "accessory_id", capabilityId = "capability_id", sensitivity, parked
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `AccessoryCapabilitySettingsEntity`
struct SavedAccessoryCapabilitySettings: Codable, FetchableRecord, PersistableRecord, Equatable {
  static let databaseTableName = "accessory_capability_settings"
  let accessoryId: String
  let capabilityId: String
  let enabled: Bool
  var samplingRateHz: Double? = nil
  enum CodingKeys: String, CodingKey {
    case accessoryId = "accessory_id", capabilityId = "capability_id", enabled
    case samplingRateHz = "sampling_rate_hz"
  }
}
