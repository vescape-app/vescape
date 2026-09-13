package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Enrolled Accessories through the production Room path, driven by the shared contract fixture the
 * GRDB host runs too.
 *
 * The scenario is the one that actually matters for this table: an Accessory the rider renamed and
 * re-flashed, met again on a different BLE handle, must stay one Accessory. If identity ever slipped
 * to the name or the handle, this is where two rows would appear.
 *
 * The second scenario covers what the rider calibrated for it: keyed on the capability as well, so a
 * nose sensor and a tail sensor on one unit never share numbers, and taken with the Accessory when
 * it is forgotten.
 *
 * @parity /modules/vescape-core/persistence-macos/main.swift `accessory-enrollment-close-reopen`
 */
class AccessoryPersistenceHostTest {
  private fun fixture(): JSONObject =
    JSONObject(Files.readString(java.nio.file.Path.of("../shared/accessory-persistence-contract.json")))

  @Test fun anAccessorySurvivesCloseReopenAndARenameNeverDuplicatesIt(): Unit = runBlocking {
    val contract = fixture()
    assertEquals("accessory-enrollment-close-reopen", contract.getString("scenario"))
    val spec = contract.getJSONObject("accessory")
    val other = contract.getJSONObject("other")

    val path = Files.createTempFile("vescape-accessories", ".db")
    Files.deleteIfExists(path)
    fun open() = Room.databaseBuilder<TelemetryRoomDatabase>(path.toString())
      .setDriver(BundledSQLiteDriver())
      .build()

    var db = open()
    var store = AccessoryPersistence(db.telemetryDao())

    val enrolled = SavedAccessoryEntity(
      accessoryId = spec.getString("accessoryId"),
      name = spec.getString("name"),
      firmwareVersion = spec.getString("firmwareVersion"),
      protocolVersion = spec.getInt("protocolVersion"),
      deviceId = spec.getString("deviceId"),
      capabilitiesJson = spec.getString("capabilitiesJson"),
      enrolledAt = spec.getLong("enrolledAt"),
      lastConnectedAt = null,
    )
    store.upsert(enrolled)
    store.upsert(
      SavedAccessoryEntity(
        accessoryId = other.getString("accessoryId"),
        name = other.getString("name"),
        firmwareVersion = other.getString("firmwareVersion"),
        protocolVersion = other.getInt("protocolVersion"),
        deviceId = other.getString("deviceId"),
        capabilitiesJson = other.getString("capabilitiesJson"),
        enrolledAt = other.getLong("enrolledAt"),
        lastConnectedAt = null,
      ),
    )
    db.close()

    db = open()
    store = AccessoryPersistence(db.telemetryDao())
    val reopened = store.getAccessories()
    assertEquals(listOf(spec.getString("accessoryId"), other.getString("accessoryId")), reopened.map { it.accessoryId })
    assertEquals(spec.getString("capabilitiesJson"), reopened.first().capabilitiesJson)
    assertNull(reopened.first().lastConnectedAt)

    // The same unit after a rename, a firmware update and a new BLE handle. Anything keyed on a
    // name or an address would add a second row here.
    val observed = enrolled.copy(
      name = spec.getString("renamedTo"),
      firmwareVersion = spec.getString("updatedFirmwareVersion"),
      deviceId = spec.getString("movedDeviceId"),
      capabilitiesJson = spec.getString("changedCapabilitiesJson"),
      enrolledAt = spec.getLong("reEnrolledAt"),
      lastConnectedAt = spec.getLong("connectedAt"),
    )
    assertTrue(store.revalidate(observed))
    assertEquals(2, store.getAccessories().size)

    // Update-only: a handshake landing after the rider forgot an Accessory must not recreate it.
    assertFalse(store.revalidate(observed.copy(accessoryId = "not-enrolled")))
    assertEquals(2, store.getAccessories().size)
    db.close()

    db = open()
    store = AccessoryPersistence(db.telemetryDao())
    val persisted = store.getAccessory(spec.getString("accessoryId"))!!
    assertEquals(spec.getString("renamedTo"), persisted.name)
    assertEquals(spec.getString("updatedFirmwareVersion"), persisted.firmwareVersion)
    assertEquals(spec.getString("movedDeviceId"), persisted.deviceId)
    assertEquals(spec.getLong("connectedAt"), persisted.lastConnectedAt)
    // Reading a manifest again is not adding the Accessory again.
    assertEquals(spec.getLong("enrolledAt"), persisted.enrolledAt)
    // The baseline the rider's saved settings were validated against survives revalidation. It is
    // what the "declared limits changed" warning is derived from, so overwriting it here would make
    // the warning vanish on the next launch.
    assertEquals(spec.getString("capabilitiesJson"), persisted.capabilitiesJson)

    // Forgetting takes the Accessory and nothing else: the other enrollment is untouched.
    assertTrue(store.forget(spec.getString("accessoryId")))
    assertFalse(store.forget(spec.getString("accessoryId")))
    db.close()

    db = open()
    store = AccessoryPersistence(db.telemetryDao())
    assertEquals(listOf(other.getString("accessoryId")), store.getAccessories().map { it.accessoryId })
    db.close()
    Files.deleteIfExists(path)
  }

  @Test fun calibrationSurvivesRestartAndIsForgottenWithItsAccessory(): Unit = runBlocking {
    val contract = fixture()
    val spec = contract.getJSONObject("accessory")
    val other = contract.getJSONObject("other")
    val clearance = contract.getJSONObject("groundClearance")
    val accessoryId = spec.getString("accessoryId")
    val otherId = other.getString("accessoryId")
    val nose = clearance.getString("capabilityId")
    val tail = clearance.getString("tailCapabilityId")

    val path = Files.createTempFile("vescape-ground-clearance", ".db")
    Files.deleteIfExists(path)
    fun open() = Room.databaseBuilder<TelemetryRoomDatabase>(path.toString())
      .setDriver(BundledSQLiteDriver())
      .build()

    fun row(owner: String, capabilityId: String, json: JSONObject) = AccessoryGroundClearanceEntity(
      accessoryId = owner,
      capabilityId = capabilityId,
      nearCm = json.getDouble("nearCm"),
      farCm = json.getDouble("farCm"),
      direction = json.getString("direction"),
      strengthPercent = json.getInt("strengthPercent"),
      updatedAt = json.getLong("updatedAt"),
    )

    var db = open()
    var store = AccessoryPersistence(db.telemetryDao())
    for (owner in listOf(spec, other)) {
      store.upsert(
        SavedAccessoryEntity(
          accessoryId = owner.getString("accessoryId"),
          name = owner.getString("name"),
          firmwareVersion = owner.getString("firmwareVersion"),
          protocolVersion = owner.getInt("protocolVersion"),
          deviceId = owner.getString("deviceId"),
          capabilitiesJson = owner.getString("capabilitiesJson"),
          enrolledAt = owner.getLong("enrolledAt"),
          lastConnectedAt = null,
        ),
      )
    }
    val light = contract.getJSONObject("brakeLight")
    val lightRow = AccessoryBrakeLightEntity(accessoryId, light.getString("capabilityId"), light.getInt("sensitivity"), light.getString("parked"))
    store.saveBrakeLight(lightRow)
    store.saveBrakeLight(lightRow.copy(accessoryId = otherId))
    store.saveGroundClearance(row(accessoryId, nose, clearance.getJSONObject("calibration")))
    store.saveGroundClearance(row(accessoryId, tail, clearance.getJSONObject("tailCalibration")))
    store.saveGroundClearance(
      row(otherId, other.getString("capabilityId"), other.getJSONObject("calibration")),
    )
    db.close()

    // Settings survive restart: the whole reason this is a table and not process state.
    db = open()
    store = AccessoryPersistence(db.telemetryDao())
    assertEquals(listOf(lightRow, lightRow.copy(accessoryId = otherId)).sortedBy { it.accessoryId }, store.getBrakeLights())
    val reopened = store.getGroundClearance(accessoryId, nose)!!
    assertEquals(clearance.getJSONObject("calibration").getDouble("nearCm"), reopened.nearCm, 0.0)
    assertEquals(clearance.getJSONObject("calibration").getDouble("farCm"), reopened.farCm, 0.0)
    assertEquals(clearance.getJSONObject("calibration").getString("direction"), reopened.direction)
    assertEquals(
      clearance.getJSONObject("calibration").getInt("strengthPercent"),
      reopened.strengthPercent,
    )
    assertEquals(3, store.getGroundClearances().size)

    // The composite key doing its job: recalibrating the nose sensor leaves the tail sensor alone.
    // Keyed on the Accessory alone, the second row would have overwritten the first.
    store.saveGroundClearance(row(accessoryId, nose, clearance.getJSONObject("recalibrated")))
    assertEquals(3, store.getGroundClearances().size)
    assertEquals(
      clearance.getJSONObject("recalibrated").getDouble("nearCm"),
      store.getGroundClearance(accessoryId, nose)!!.nearCm,
      0.0,
    )
    assertEquals(
      clearance.getJSONObject("tailCalibration").getString("direction"),
      store.getGroundClearance(accessoryId, tail)!!.direction,
    )

    // Reading a manifest again must not disturb what the rider set.
    assertTrue(
      store.revalidate(
        store.getAccessory(accessoryId)!!.copy(
          name = spec.getString("renamedTo"),
          lastConnectedAt = spec.getLong("connectedAt"),
        ),
      ),
    )
    assertEquals(3, store.getGroundClearances().size)
    // ...and it must not move the baseline either. Only accepting new limits does that.
    assertEquals(spec.getString("capabilitiesJson"), store.getAccessory(accessoryId)!!.capabilitiesJson)

    // Accepting limits that moved, which is what saving a fitting calibration means.
    assertTrue(store.adoptCapabilities(accessoryId, spec.getString("changedCapabilitiesJson")))
    assertEquals(
      spec.getString("changedCapabilitiesJson"),
      store.getAccessory(accessoryId)!!.capabilitiesJson,
    )
    assertFalse(store.adoptCapabilities("not-enrolled", spec.getString("capabilitiesJson")))
    db.close()

    db = open()
    store = AccessoryPersistence(db.telemetryDao())
    assertTrue(store.clearGroundClearance(accessoryId, tail))
    assertFalse(store.clearGroundClearance(accessoryId, tail))
    assertEquals(2, store.getGroundClearances().size)

    // Forgetting takes the Accessory and every calibration made against it, and nothing else.
    assertTrue(store.forget(accessoryId))
    assertEquals(listOf(lightRow.copy(accessoryId = otherId)), store.getBrakeLights())
    db.close()

    db = open()
    store = AccessoryPersistence(db.telemetryDao())
    assertNull(store.getGroundClearance(accessoryId, nose))
    assertEquals(
      listOf(otherId),
      store.getGroundClearances().map { it.accessoryId },
    )
    db.close()
    Files.deleteIfExists(path)
  }
}
