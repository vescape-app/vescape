package expo.modules.vescapecore.telemetry

/**
 * Durable Accessory enrollment. Production Room operations shared by the Android adapter and the
 * host persistence contract.
 *
 * Everything here keys on the manifest's persistent accessory id. That is the whole point of the
 * store: an Accessory is remembered because the rider enrolled *it*, not because it happened to
 * answer on a BLE handle, so a new name, a firmware bump or a rotated MAC all land on the same row.
 *
 * @parity /modules/vescape-core/ios/telemetry/AccessoryPersistence.swift
 */
internal class AccessoryPersistence(private val dao: TelemetryDao) {
  suspend fun getAccessories(): List<SavedAccessoryEntity> = dao.getAccessories()

  suspend fun getAccessory(accessoryId: String): SavedAccessoryEntity? = dao.getAccessory(accessoryId)

  /**
   * Enrollment, and the re-validation every later handshake performs.
   *
   * [enrolledAt] is preserved across re-validation: it says when the rider added this Accessory,
   * and reading a manifest again is not adding it again.
   */
  suspend fun upsert(accessory: SavedAccessoryEntity): SavedAccessoryEntity {
    val existing = dao.getAccessory(accessory.accessoryId)
    val row = if (existing == null) accessory else accessory.copy(enrolledAt = existing.enrolledAt)
    dao.upsertAccessory(row)
    return row
  }

  suspend fun forget(accessoryId: String): Boolean = dao.deleteAccessory(accessoryId) > 0

  suspend fun touch(accessoryId: String, deviceId: String?, connectedAt: Long): Boolean =
    dao.touchAccessory(accessoryId, deviceId, connectedAt) > 0
}
