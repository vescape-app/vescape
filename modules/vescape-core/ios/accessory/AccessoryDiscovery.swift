import CoreBluetooth
import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryDiscovery.kt
final class AccessoryDiscovery: NSObject {
  static let shared = AccessoryDiscovery()

  var emit: ((String, [String: Any?]) -> Void)?

  private lazy var central = CBCentralManager(delegate: self, queue: nil)
  private var scanRequested = false
  private var handshake: AccessoryGattHandshake?
  private var pendingInspection: (deviceId: String, onResult: ([String: Any?]) -> Void)?
  private var pendingTimeout: DispatchWorkItem?
  private var seen: [UUID: CBPeripheral] = [:]

  private static let centralStartupTimeout: TimeInterval = 5

  private func onMain(_ work: @escaping () -> Void) {
    if Thread.isMainThread {
      work()
    } else {
      DispatchQueue.main.async(execute: work)
    }
  }

  func startScan() {
    onMain {
      self.scanRequested = true
      guard self.central.state == .poweredOn else {
        _ = self.central
        return
      }
      self.beginScan()
    }
  }

  func stopScan() {
    onMain {
      self.scanRequested = false
      if self.central.state == .poweredOn { self.central.stopScan() }
    }
  }

  func inspect(deviceId: String, onResult: @escaping ([String: Any?]) -> Void) {
    onMain {
      guard self.handshake == nil, self.pendingInspection == nil else {
        return onResult(
          Self.payload(deviceId: deviceId, advertisedName: nil, manifest: nil, error: "busy"))
      }
      guard let uuid = UUID(uuidString: deviceId) else {
        return onResult(
          Self.payload(
            deviceId: deviceId, advertisedName: nil, manifest: nil, error: "connect-failed")
        )
      }
      self.scanRequested = false
      if self.central.state == .poweredOn { self.central.stopScan() }

      switch self.central.state {
      case .poweredOn:
        break
      case .unknown, .resetting:
        self.pendingInspection = (deviceId, onResult)
        _ = self.central
        let timeout = DispatchWorkItem { [weak self] in
          self?.resolvePending(error: "timeout")
        }
        self.pendingTimeout = timeout
        DispatchQueue.main.asyncAfter(
          deadline: .now() + Self.centralStartupTimeout, execute: timeout)
        return
      default:
        return onResult(
          Self.payload(
            deviceId: deviceId, advertisedName: nil, manifest: nil, error: "bluetooth-unavailable")
        )
      }

      guard let peripheral = self.resolve(uuid) else {
        return onResult(
          Self.payload(
            deviceId: deviceId, advertisedName: nil, manifest: nil, error: "connect-failed")
        )
      }
      self.begin(peripheral: peripheral, deviceId: deviceId, onResult: onResult)
    }
  }

  func cancelInspection() {
    onMain {
      self.resolvePending(error: "cancelled")
      self.handshake?.cancel()
    }
  }

  private func resolvePending(error: String) {
    pendingTimeout?.cancel()
    pendingTimeout = nil
    guard let pending = pendingInspection else { return }
    pendingInspection = nil
    pending.onResult(
      Self.payload(deviceId: pending.deviceId, advertisedName: nil, manifest: nil, error: error)
    )
  }

  private func beginScan() {
    seen.removeAll()
    central.scanForPeripherals(
      withServices: [AccessoryProtocol.serviceUUID],
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
      guard central.state != .unknown, central.state != .resetting else { return }
      if scanRequested || pendingInspection != nil {
        emit?("onAccessoryScanError", ["error": "bluetooth-unavailable"])
      }
      scanRequested = false
      resolvePending(error: "bluetooth-unavailable")
      return
    }
    if let pending = pendingInspection {
      pendingInspection = nil
      pendingTimeout?.cancel()
      pendingTimeout = nil
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
