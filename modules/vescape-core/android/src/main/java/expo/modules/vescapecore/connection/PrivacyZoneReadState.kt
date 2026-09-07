package expo.modules.vescapecore.connection

import expo.modules.vescapecore.telemetry.PrivacyZoneEntity

/**
 * Fail-closed privacy configuration: an empty loaded list is usable, while a failed read blocks
 * location egress and preserves the last trusted rules for inspection/retry.
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
}
