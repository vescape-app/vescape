import Foundation
import GRDB

/// One enrolled Accessory: the durable half of an Accessory, and the only reason one auto-connects.
///
/// Identity is `accessoryId` — the persistent UUID the manifest carries — never the peripheral id
/// and never the name. Both of those move: iOS mints a per-install peripheral id, Android sees a
/// rotating MAC, and the rider can rename the unit from its own firmware. Keying on the manifest id
/// is what makes a renamed Accessory the same Accessory instead of a second one.
///
/// `deviceId` is a reconnect hint and nothing more. A stale one costs a scan, never a duplicate row.
///
/// `capabilitiesJson` is the capability set validated at the last successful handshake. Every
/// reconnect reads the manifest again and compares: a capability whose declared limits moved is a
/// capability whose saved per-capability settings may no longer fit.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `SavedAccessoryEntity`
/// @parity /modules/vescape-core/src/index.ts `SavedAccessory`
struct SavedAccessory: Equatable {
  let accessoryId: String
  let name: String
  let firmwareVersion: String
  /// Last agreed protocol version, or nil when the two sides found none.
  let protocolVersion: Int?
  /// Where it answered last. A hint for the next connect, not identity.
  let deviceId: String?
  let capabilitiesJson: String
  let enrolledAt: Int64
  let lastConnectedAt: Int64?
}

/// What the rider calibrated for one ground-clearance capability.
///
/// Keyed on the Accessory *and* the capability, never on the Accessory alone: the protocol lets one
/// unit declare several measurement capabilities, and the eventual hardware has a nose sensor and a
/// tail sensor on the same board. Collapsing this onto the Accessory row would make those two share
/// a calibration, which is the one thing they can never do.
///
/// There is no partial row and no draft. A calibration is written when it is complete and valid, so
/// anything stored here was a usable calibration at the moment it was saved. Whether it is still one
/// is decided against the live manifest every session.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `AccessoryGroundClearanceEntity`
/// @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceCalibration`
struct SavedGroundClearance: Equatable {
  let accessoryId: String
  /// Stable within the Accessory and across firmware updates, exactly as the manifest declares it.
  let capabilityId: String
  /// Clearance at which correction is at full strength. Always below `farCm`.
  let nearCm: Double
  /// Clearance at which correction starts. Above it nothing is commanded.
  let farCm: Double
  /// Raw wire value for where the sensor is mounted. A value this app cannot read is incomplete.
  let direction: String
  /// Maximum Remote Tilt input this binding may command, as a percentage.
  let strengthPercent: Int
  let updatedAt: Int64
}

/// Durable Accessory enrollment. Production GRDB operations shared by the app and the macOS host
/// persistence contract.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AccessoryPersistence.kt
struct AccessoryStore {
  private struct WriterUnavailable: Error {}
  private let resolveWriter: () -> DatabaseWriter?

  static let shared = AccessoryStore { TelemetryDatabase.pool }

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

  /// Enrollment. `enrolledAt` is preserved when the row already exists: re-adding an Accessory the
  /// rider already has is not a new enrollment.
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

  /// Forgetting takes the enrollment and every calibration made against it, in one transaction.
  ///
  /// The calibration goes first. Deleting the identity alone would leave rows nothing can reach and
  /// nothing can clean up — and re-adding the same hardware later would find them and drive the
  /// board to numbers the rider set for a mounting position they have since changed.
  @discardableResult
  func forget(_ accessoryId: String) throws -> Bool {
    try writer().write { db in
      try db.execute(
        sql: "DELETE FROM accessory_ground_clearance WHERE accessory_id = ?",
        arguments: [accessoryId])
      try db.execute(sql: "DELETE FROM accessory_brake_light WHERE accessory_id = ?", arguments: [accessoryId])
      return try Record.deleteOne(db, key: ["accessory_id": accessoryId])
    }
  }

  /// Adopts the capability set the current manifest declares as the new baseline.
  ///
  /// The counterpart to `revalidate` leaving `capabilities_json` alone. That preservation is what
  /// keeps "this Accessory now declares different limits" alive across a restart; this is the rider
  /// answering it, by saving a calibration that fits what the hardware says today.
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

  func saveBrakeLight(_ settings: SavedBrakeLight) throws {
    try writer().write { db in
      guard try Record.fetchOne(db, key: ["accessory_id": settings.accessoryId]) != nil else { throw WriterUnavailable() }
      try settings.save(db)
    }
  }

  // MARK: - Ground-clearance calibration

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

  /// Saves one complete calibration.
  ///
  /// There is no Save button behind this and no draft state in the table: the screen calls it when
  /// what the rider has entered is complete and valid, so every row here was usable at the moment
  /// it was written. Validity against the *current* manifest is re-decided on every session.
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

  /// Refreshes what the last handshake observed, for an Accessory that is still enrolled.
  ///
  /// Update-only, and deliberately not an upsert: a handshake that completes just as the rider
  /// forgets the Accessory would otherwise resurrect the row it just deleted, and the next launch
  /// would auto-connect hardware the rider removed. A single UPDATE is a no-op on a missing row.
  ///
  /// `capabilities_json` is **not** touched. It is the baseline the rider's saved settings were
  /// validated against, so it stays put until a capability's own setup accepts the new limits;
  /// overwriting it here would make the "limits changed" warning disappear on the next launch.
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `AccessoryBrakeLightEntity`
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
