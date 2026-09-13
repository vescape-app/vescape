import CoreBluetooth
import Foundation

/// Finding Accessories and asking each one what it is. Scanning matches the Vescape Accessory
/// service UUID, never a name: a name is a label the rider can change and other hardware can copy,
/// so it identifies nothing. The service is what makes a device an Accessory.
///
/// Discovery is read-only by construction. It hands each device to a short-lived
/// `AccessoryGattHandshake` that writes one `hello`, reads the manifest, and disconnects; nothing on
/// this path can command an Accessory, and finding one never enrolls it. Enrollment is an explicit
/// rider action in a later slice.
///
/// One inspection runs at a time. Two concurrent handshakes against the same radio mostly produce
/// two timeouts, and the rider is looking at one row anyway.
///
/// A central of its own, deliberately separate from the Board Session's: discovery must not disturb
/// a live Board link, and it never opts into CoreBluetooth state restoration — an accessory scan is
/// not worth resurrecting the app for.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryDiscovery.kt
final class AccessoryDiscovery: NSObject {
  static let shared = AccessoryDiscovery()

  /// Set by the Expo module so discovery can push devices without holding a module reference.
  var emit: ((String, [String: Any?]) -> Void)?

  private lazy var central = CBCentralManager(delegate: self, queue: nil)
  private var scanRequested = false
  private var handshake: AccessoryGattHandshake?
  private var pendingInspection: (deviceId: String, onResult: ([String: Any?]) -> Void)?
  /// Peripherals the scan saw, retained so a later `inspect` has something to connect to.
  private var seen: [UUID: CBPeripheral] = [:]

  func startScan() {
    scanRequested = true
    guard central.state == .poweredOn else {
      // The central reports `.poweredOn` asynchronously on first use; the scan starts there.
      _ = central
      return
    }
    beginScan()
  }

  func stopScan() {
    scanRequested = false
    if central.state == .poweredOn { central.stopScan() }
  }

  /// Connects to one discovered device and reads its manifest. `onResult` receives the bridge
  /// payload exactly once, whether the handshake succeeded, was rejected, or timed out.
  func inspect(deviceId: String, onResult: @escaping ([String: Any?]) -> Void) {
    guard handshake == nil, pendingInspection == nil else {
      return onResult(Self.payload(deviceId: deviceId, advertisedName: nil, manifest: nil, error: "busy"))
    }
    guard let uuid = UUID(uuidString: deviceId) else {
      return onResult(
        Self.payload(deviceId: deviceId, advertisedName: nil, manifest: nil, error: "connect-failed")
      )
    }
    // Scanning while a handshake runs slows the connection down for no benefit: the rider has
    // already picked a row.
    stopScan()

    guard central.state == .poweredOn else {
      pendingInspection = (deviceId, onResult)
      _ = central
      return
    }
    guard let peripheral = resolve(uuid) else {
      return onResult(
        Self.payload(deviceId: deviceId, advertisedName: nil, manifest: nil, error: "connect-failed")
      )
    }
    begin(peripheral: peripheral, deviceId: deviceId, onResult: onResult)
  }

  /// Abandons an inspection the rider walked away from.
  func cancelInspection() {
    pendingInspection = nil
    handshake?.cancel()
  }

  // MARK: - Internals

  private func beginScan() {
    seen.removeAll()
    central.scanForPeripherals(
      withServices: [AccessoryProtocol.serviceUUID],
      // Every advertisement, not one per peripheral: the row shows a live RSSI.
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
    )
  }

  private func resolve(_ uuid: UUID) -> CBPeripheral? {
    seen[uuid] ?? central.retrievePeripherals(withIdentifiers: [uuid]).first
  }

  private func begin(
    peripheral: CBPeripheral,
    deviceId: String,
    onResult: @escaping ([String: Any?]) -> Void
  ) {
    peripheral.delegate = self
    let session = AccessoryGattHandshake(
      peripheral: peripheral,
      central: central,
      sessionId: UUID().uuidString
    ) { [weak self] outcome in
      self?.handshake = nil
      switch outcome {
      case .ok(let manifest, let advertisedName):
        onResult(
          Self.payload(
            deviceId: deviceId, advertisedName: advertisedName, manifest: manifest, error: nil)
        )
      case .failed(let error, let advertisedName):
        onResult(
          Self.payload(
            deviceId: deviceId, advertisedName: advertisedName, manifest: nil, error: error)
        )
      }
    }
    handshake = session
    session.start()
  }

  private static func payload(
    deviceId: String,
    advertisedName: String?,
    manifest: AccessoryManifest?,
    error: String?
  ) -> [String: Any?] {
    [
      "deviceId": deviceId,
      "advertisedName": advertisedName,
      "manifest": manifest?.toMap(),
      "error": error,
    ]
  }
}

extension AccessoryDiscovery: CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard central.state == .poweredOn else {
      if scanRequested || pendingInspection != nil {
        emit?("onAccessoryScanError", ["error": "bluetooth-unavailable"])
      }
      if let pending = pendingInspection {
        pendingInspection = nil
        pending.onResult(
          Self.payload(
            deviceId: pending.deviceId, advertisedName: nil, manifest: nil,
            error: "bluetooth-unavailable")
        )
      }
      return
    }
    if let pending = pendingInspection {
      pendingInspection = nil
      guard let uuid = UUID(uuidString: pending.deviceId), let peripheral = resolve(uuid) else {
        return pending.onResult(
          Self.payload(
            deviceId: pending.deviceId, advertisedName: nil, manifest: nil, error: "connect-failed")
        )
      }
      begin(peripheral: peripheral, deviceId: pending.deviceId, onResult: pending.onResult)
      return
    }
    if scanRequested { beginScan() }
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    seen[peripheral.identifier] = peripheral
    emit?(
      "onAccessoryDevice",
      [
        "id": peripheral.identifier.uuidString,
        // Nullable on purpose: a device that advertises no name is still a valid Accessory, and
        // the manifest is where its real name comes from anyway.
        "name": advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name,
        "rssi": RSSI.intValue,
      ]
    )
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    guard handshake?.peripheralId == peripheral.identifier else { return }
    handshake?.onConnected()
  }

  func centralManager(
    _ central: CBCentralManager,
    didFailToConnect peripheral: CBPeripheral,
    error: Error?
  ) {
    guard handshake?.peripheralId == peripheral.identifier else { return }
    handshake?.onConnectFailed()
  }

  func centralManager(
    _ central: CBCentralManager,
    didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?
  ) {
    guard handshake?.peripheralId == peripheral.identifier else { return }
    handshake?.onDisconnected()
  }
}

extension AccessoryDiscovery: CBPeripheralDelegate {
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard handshake?.peripheralId == peripheral.identifier else { return }
    handshake?.onServicesDiscovered(error: error)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didDiscoverCharacteristicsFor service: CBService,
    error: Error?
  ) {
    guard handshake?.peripheralId == peripheral.identifier else { return }
    handshake?.onCharacteristicsDiscovered(for: service, error: error)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateNotificationStateFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard handshake?.peripheralId == peripheral.identifier else { return }
    handshake?.onNotifyStateChanged(for: characteristic, error: error)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didWriteValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard handshake?.peripheralId == peripheral.identifier else { return }
    handshake?.onWriteCompleted(error: error)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard handshake?.peripheralId == peripheral.identifier else { return }
    handshake?.onValueUpdated(for: characteristic, error: error)
  }
}
