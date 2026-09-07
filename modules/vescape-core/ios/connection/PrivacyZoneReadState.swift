/// Fail-closed privacy configuration: an empty loaded list is usable, while a failed read blocks
/// location egress and preserves the last trusted rules for inspection/retry.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/PrivacyZoneReadState.kt
internal struct PrivacyZoneReadState {
  private(set) var zones: [PrivacyZoneEntity] = []
  private(set) var ready = false
  var allowsLocationEgress: Bool { ready }

  mutating func reload(_ read: () throws -> [PrivacyZoneEntity]) throws {
    do {
      zones = try read()
      ready = true
    } catch {
      ready = false
      throw error
    }
  }
}
