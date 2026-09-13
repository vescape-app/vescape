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

  static func createTables(_ db: Database) throws { try PersistenceSchema.createAccessories(db) }

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

  /// Enrollment, and the re-validation every later handshake performs.
  ///
  /// `enrolledAt` is preserved across re-validation: it says when the rider added this Accessory,
  /// and reading a manifest again is not adding it again.
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
    try writer().write { db in try Record.deleteOne(db, key: ["accessory_id": accessoryId]) }
  }

  /// Records a successful session without rewriting the manifest facts the handshake validated.
  @discardableResult
  func touch(_ accessoryId: String, deviceId: String?, connectedAt: Int64) throws -> Bool {
    try writer().write { db in
      try db.execute(
        sql:
          "UPDATE accessories SET device_id = ?, last_connected_at = ? WHERE accessory_id = ?",
        arguments: [deviceId, connectedAt, accessoryId])
      return db.changesCount > 0
    }
  }
}
