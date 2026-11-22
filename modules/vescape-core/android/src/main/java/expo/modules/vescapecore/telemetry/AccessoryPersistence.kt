package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.database.AccessoryBrakeLightEntity
import expo.modules.vescapecore.database.AccessoryCapabilitySettingsEntity
import expo.modules.vescapecore.database.AccessoryGroundClearanceEntity
import expo.modules.vescapecore.database.SavedAccessoryEntity
import expo.modules.vescapecore.database.VescapeDao

/**
 * @parity /modules/vescape-core/ios/telemetry/AccessoryPersistence.swift
 */
internal class AccessoryPersistence(private val dao: VescapeDao) {
  suspend fun getAccessories(): List<SavedAccessoryEntity> = dao.getAccessories()

  suspend fun getAccessory(accessoryId: String): SavedAccessoryEntity? = dao.getAccessory(accessoryId)

  suspend fun upsert(accessory: SavedAccessoryEntity): SavedAccessoryEntity {
    val existing = dao.getAccessory(accessory.accessoryId)
    val row = if (existing == null) accessory else accessory.copy(enrolledAt = existing.enrolledAt)
    dao.upsertAccessory(row)
    return row
  }

  suspend fun revalidate(accessory: SavedAccessoryEntity): Boolean =
    dao.revalidateAccessory(
      accessoryId = accessory.accessoryId,
      name = accessory.name,
      firmwareVersion = accessory.firmwareVersion,
      protocolVersion = accessory.protocolVersion,
      deviceId = accessory.deviceId,
      connectedAt = accessory.lastConnectedAt,
    ) > 0

  suspend fun adoptCapabilities(accessoryId: String, capabilitiesJson: String): Boolean =
    dao.adoptAccessoryCapabilities(accessoryId, capabilitiesJson) > 0

  suspend fun forget(accessoryId: String): Boolean = dao.forgetAccessory(accessoryId) > 0

  suspend fun getBrakeLights(): List<AccessoryBrakeLightEntity> = dao.getBrakeLights()

  suspend fun getCapabilitySettings(): List<AccessoryCapabilitySettingsEntity> = dao.getAccessoryCapabilitySettings()

  suspend fun saveCapabilitySettings(settings: AccessoryCapabilitySettingsEntity) = dao.saveAccessoryCapabilitySettings(settings)

  suspend fun saveBrakeLight(settings: AccessoryBrakeLightEntity) = dao.saveBrakeLight(settings)

  suspend fun getGroundClearances(): List<AccessoryGroundClearanceEntity> = dao.getGroundClearances()

  suspend fun getGroundClearance(accessoryId: String, capabilityId: String): AccessoryGroundClearanceEntity? =
    dao.getGroundClearance(accessoryId, capabilityId)

  suspend fun saveGroundClearance(calibration: AccessoryGroundClearanceEntity) {
    dao.upsertGroundClearance(calibration)
  }

  suspend fun clearGroundClearance(accessoryId: String, capabilityId: String): Boolean =
    dao.deleteGroundClearance(accessoryId, capabilityId) > 0
}
