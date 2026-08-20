import CoreBluetooth
import Foundation

/// Real CoreBluetooth behind `PresenceScanPort`.
///
/// The session central is shared with the Board Session, so this adapter does not own callbacks: it
/// starts and stops discovery and receives readiness / advertisements forwarded by
/// `BoardSessionController`'s `VescGattListener` conformance.
///
/// Readiness is the central reaching `.poweredOn` — the moment the five-second Presence Scan window
/// may start, which on iOS is meaningfully later than foreground entry.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BlePresenceScanPort.kt
internal final class BlePresenceScanPort: PresenceScanPort {
  private let central: () -> CBManagerState
  private let start: () -> Void
  private let stop: () -> Void

  private var onReady: (() -> Void)?
  private var onObserved: ((String, Int?) -> Void)?
  private var onFailed: ((String) -> Void)?

  init(
    central: @escaping () -> CBManagerState,
    start: @escaping () -> Void,
    stop: @escaping () -> Void
  ) {
    self.central = central
    self.start = start
    self.stop = stop
  }

  func bluetoothEnabled() -> Bool {
    // `.unknown` / `.resetting` are "not yet answered", not "off": the scan waits for readiness
    // instead of being refused with `bluetooth_disabled`.
    central() != .poweredOff
  }

  func scanPermissionGranted() -> Bool {
    CBCentralManager.authorization == .allowedAlways || central() != .unauthorized
  }

  func scannerAvailable() -> Bool { central() != .unsupported }

  func startScan(
    onReady: @escaping () -> Void,
    onObserved: @escaping (String, Int?) -> Void,
    onFailed: @escaping (String) -> Void
  ) -> Bool {
    self.onReady = onReady
    self.onObserved = onObserved
    self.onFailed = onFailed
    start()
    // A central already powered on never emits another state change, so readiness is reported here.
    if central() == .poweredOn { onReady() }
    return true
  }

  func stopScan() {
    onReady = nil
    onObserved = nil
    onFailed = nil
    stop()
  }

  // MARK: - Forwarded from the shared `VescGattListener`

  /// The central reached `.poweredOn` after the scan was requested.
  func deliverReady() {
    onReady?()
  }

  func deliverObserved(id: String, rssi: Int) {
    onObserved?(id, rssi)
  }

  func deliverFailure(_ message: String) {
    onFailed?(message)
  }
}
