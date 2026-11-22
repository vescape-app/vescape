package expo.modules.vescapecore.connection

import expo.modules.vescapecore.RiderSignalContext
import expo.modules.vescapecore.RiderSignals
import expo.modules.vescapecore.database.PrivacyZoneEntity
import expo.modules.vescapecore.protocol.LocationSnapshot
import expo.modules.vescapecore.telemetry.isInsideAnyPrivacyZone
import kotlin.math.roundToInt

/**
 * @parity /modules/vescape-core/ios/connection/PrivacyZoneReadState.swift
 */
internal class PrivacyZoneReadState {
  private var storedZones: List<PrivacyZoneEntity> = emptyList()
  private var ready = false
  val zones: List<PrivacyZoneEntity> get() = synchronized(this) { storedZones }
  val allowsLocationEgress: Boolean get() = synchronized(this) { ready }

  suspend fun reload(read: suspend () -> List<PrivacyZoneEntity>) {
    val loaded = try {
      read()
    } catch (error: Throwable) {
      synchronized(this) { ready = false }
      throw error
    }
    synchronized(this) {
      storedZones = loaded
      ready = true
    }
  }

  fun presenceFix(location: LocationSnapshot?): LocationSnapshot? =
    location?.takeIf { allowsLocationEgress && !contains(it) }

  fun signalContext(location: LocationSnapshot?, nowMs: Long): RiderSignalContext {
    val recent = location?.takeIf { nowMs - it.timestamp <= RiderSignals.FIX_MAX_AGE_MS }
    return RiderSignalContext(
      fix = recent?.let { it.latitude to it.longitude },
      insidePrivacyZone = !allowsLocationEgress || (recent != null && contains(recent)),
    )
  }

  private fun contains(location: LocationSnapshot): Boolean {
    val zones = zones
    if (zones.isEmpty()) return false
    return isInsideAnyPrivacyZone(
      (location.latitude * 10_000_000.0).roundToInt(),
      (location.longitude * 10_000_000.0).roundToInt(),
      zones,
    )
  }
}
