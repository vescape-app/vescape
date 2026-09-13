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

  /**
   * Adopts the capability set the current manifest declares as the new baseline.
   *
   * The counterpart to [revalidate] leaving `capabilities_json` alone. That preservation is what
   * keeps "this Accessory now declares different limits" alive across a restart; this is the rider
   * answering it, by saving a calibration that fits what the hardware says today. Update-only for
   * the same reason revalidation is.
   */
  suspend fun adoptCapabilities(accessoryId: String, capabilitiesJson: String): Boolean =
    dao.adoptAccessoryCapabilities(accessoryId, capabilitiesJson) > 0

  /** Forgetting takes the enrollment and every calibration made against it, in one transaction. */
  suspend fun forget(accessoryId: String): Boolean = dao.forgetAccessory(accessoryId) > 0

  suspend fun getBrakeLights(): List<AccessoryBrakeLightEntity> = dao.getBrakeLights()

  suspend fun saveBrakeLight(settings: AccessoryBrakeLightEntity) = dao.saveBrakeLight(settings)

  suspend fun getGroundClearances(): List<AccessoryGroundClearanceEntity> = dao.getGroundClearances()

  suspend fun getGroundClearance(accessoryId: String, capabilityId: String): AccessoryGroundClearanceEntity? =
    dao.getGroundClearance(accessoryId, capabilityId)

  /**
   * Saves one complete calibration.
   *
   * There is no Save button behind this and no draft state in the table: the screen calls it when
   * what the rider has entered is complete and valid, so every row here was usable at the moment it
   * was written. Validity against the *current* manifest is re-decided on every session.
   */
  suspend fun saveGroundClearance(calibration: AccessoryGroundClearanceEntity) {
    dao.upsertGroundClearance(calibration)
  }

  suspend fun clearGroundClearance(accessoryId: String, capabilityId: String): Boolean =
    dao.deleteGroundClearance(accessoryId, capabilityId) > 0
}
