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
    val revalidated = store.upsert(
      enrolled.copy(
        name = spec.getString("renamedTo"),
        firmwareVersion = spec.getString("updatedFirmwareVersion"),
        deviceId = spec.getString("movedDeviceId"),
        capabilitiesJson = spec.getString("changedCapabilitiesJson"),
        enrolledAt = spec.getLong("reEnrolledAt"),
      ),
    )
    assertEquals(2, store.getAccessories().size)
    assertEquals(spec.getString("renamedTo"), revalidated.name)
    // Reading a manifest again is not adding the Accessory again.
    assertEquals(spec.getLong("enrolledAt"), revalidated.enrolledAt)

    assertTrue(store.touch(spec.getString("accessoryId"), spec.getString("movedDeviceId"), spec.getLong("connectedAt")))
    assertFalse(store.touch("not-enrolled", null, spec.getLong("connectedAt")))
    db.close()

    db = open()
    store = AccessoryPersistence(db.telemetryDao())
    val persisted = store.getAccessory(spec.getString("accessoryId"))!!
    assertEquals(spec.getString("updatedFirmwareVersion"), persisted.firmwareVersion)
    assertEquals(spec.getString("movedDeviceId"), persisted.deviceId)
    assertEquals(spec.getString("changedCapabilitiesJson"), persisted.capabilitiesJson)
    assertEquals(spec.getLong("connectedAt"), persisted.lastConnectedAt)

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
}
