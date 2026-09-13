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
   * Enrollment. [enrolledAt] is preserved when the row already exists: re-adding an Accessory the
   * rider already has is not a new enrollment.
   */
  suspend fun upsert(accessory: SavedAccessoryEntity): SavedAccessoryEntity {
    val existing = dao.getAccessory(accessory.accessoryId)
    val row = if (existing == null) accessory else accessory.copy(enrolledAt = existing.enrolledAt)
    dao.upsertAccessory(row)
    return row
  }

  /**
   * Refreshes what the last handshake observed, for an Accessory that is still enrolled.
   *
   * Update-only, and deliberately not an upsert: a handshake that completes just as the rider
   * forgets the Accessory would otherwise resurrect the row it just deleted, and the next launch
   * would auto-connect hardware the rider removed. A single UPDATE is a no-op on a missing row.
   *
   * `capabilities_json` is **not** touched. It is the baseline the rider's saved settings were
   * validated against, so it stays put until a capability's own setup accepts the new limits;
   * overwriting it here would make the "limits changed" warning disappear on the next launch.
   */
  suspend fun revalidate(accessory: SavedAccessoryEntity): Boolean =
    dao.revalidateAccessory(
      accessoryId = accessory.accessoryId,
      name = accessory.name,
      firmwareVersion = accessory.firmwareVersion,
      protocolVersion = accessory.protocolVersion,
      deviceId = accessory.deviceId,
      connectedAt = accessory.lastConnectedAt,
    ) > 0

  suspend fun forget(accessoryId: String): Boolean = dao.deleteAccessory(accessoryId) > 0
}
