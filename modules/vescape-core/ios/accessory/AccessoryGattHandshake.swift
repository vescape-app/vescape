import CoreBluetooth
import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryGattHandshake.kt `AccessoryHandshakeOutcome`
enum AccessoryHandshakeOutcome {
  case ok(AccessoryManifest, advertisedName: String?)
  case failed(String, advertisedName: String?)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryGattHandshake.kt
final class AccessoryGattHandshake {
  private static let connectTimeout: TimeInterval = 10

  private let peripheral: CBPeripheral
  private let central: CBCentralManager
  private let sessionId: String
  private let onFinished: (AccessoryHandshakeOutcome) -> Void
  private let framer = AccessoryNdjsonFramer()

  private var writeCharacteristic: CBCharacteristic?
  private var pendingChunks: [Data] = []
  private var writeInFlight = false
  private var timeout: DispatchWorkItem?
  private var finished = false

  init(
    peripheral: CBPeripheral,
    central: CBCentralManager,
    sessionId: String,
    onFinished: @escaping (AccessoryHandshakeOutcome) -> Void
  ) {
    self.peripheral = peripheral
    self.central = central
    self.sessionId = sessionId
    self.onFinished = onFinished
  }

  var peripheralId: UUID { peripheral.identifier }

  func start() {
    arm(Self.connectTimeout, error: "timeout")
    central.connect(peripheral, options: nil)
  }

  func cancel() { finish(.failed("cancelled", advertisedName: peripheral.name)) }

  func onConnected() {
    peripheral.discoverServices([AccessoryProtocol.serviceUUID])
  }

  func onDisconnected() {
    finish(.failed("connect-failed", advertisedName: peripheral.name))
  }

  func onConnectFailed() {
    finish(.failed("connect-failed", advertisedName: peripheral.name))
  }

  func onServicesDiscovered(error: Error?) {
    guard error == nil,
      let service = peripheral.services?.first(where: { $0.uuid == AccessoryProtocol.serviceUUID })
    else { return finish(.failed("service-missing", advertisedName: peripheral.name)) }
    peripheral.discoverCharacteristics(
      [AccessoryProtocol.writeUUID, AccessoryProtocol.notifyUUID],
      for: service
    )
  }

  func onCharacteristicsDiscovered(for service: CBService, error: Error?) {
    guard error == nil, service.uuid == AccessoryProtocol.serviceUUID else {
      return finish(.failed("service-missing", advertisedName: peripheral.name))
    }
    let characteristics = service.characteristics ?? []
    guard
      let write = characteristics.first(where: { $0.uuid == AccessoryProtocol.writeUUID }),
      let notify = characteristics.first(where: { $0.uuid == AccessoryProtocol.notifyUUID })
    else { return finish(.failed("service-missing", advertisedName: peripheral.name)) }
    writeCharacteristic = write
    peripheral.setNotifyValue(true, for: notify)
  }

  func onNotifyStateChanged(for characteristic: CBCharacteristic, error: Error?) {
    guard characteristic.uuid == AccessoryProtocol.notifyUUID else { return }
    guard error == nil, characteristic.isNotifying else {
      return finish(.failed("service-missing", advertisedName: peripheral.name))
    }
    sendHello()
  }

  func onWriteCompleted(error: Error?) {
    guard error == nil else { return finish(.failed("write-failed", advertisedName: peripheral.name)) }
    writeInFlight = false
    drain()
  }

  func onValueUpdated(for characteristic: CBCharacteristic, error: Error?) {
    guard !finished, characteristic.uuid == AccessoryProtocol.notifyUUID, error == nil,
      let value = characteristic.value
    else { return }

    let result = framer.feed([UInt8](value))
    for line in result.lines {
      switch AccessoryProtocol.parseManifest(line: line, sessionId: sessionId) {
      case .ok(let manifest):
        return finish(.ok(manifest, advertisedName: peripheral.name))
      case .failed(let reason):
        if reason != .sessionMismatch {
          return finish(.failed(reason.rawValue, advertisedName: peripheral.name))
        }
      }
    }
    if let failure = result.failure {
      finish(.failed(failure.rawValue, advertisedName: peripheral.name))
    }
  }

  private func sendHello() {
    guard pendingChunks.isEmpty, !writeInFlight else { return }
    let payload = Data((AccessoryProtocol.encodeHello(sessionId: sessionId) + "\n").utf8)
    let limit = max(peripheral.maximumWriteValueLength(for: .withResponse), 20)
    var offset = 0
    while offset < payload.count {
      let end = min(offset + limit, payload.count)
      pendingChunks.append(payload.subdata(in: offset..<end))
      offset = end
    }
    arm(TimeInterval(AccessoryProtocol.handshakeTimeoutMs) / 1000, error: "timeout")
    drain()
  }

  private func drain() {
    guard !writeInFlight, let characteristic = writeCharacteristic, !pendingChunks.isEmpty else {
      return
    }
    writeInFlight = true
    peripheral.writeValue(pendingChunks.removeFirst(), for: characteristic, type: .withResponse)
  }

  private func arm(_ delay: TimeInterval, error: String) {
    timeout?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.finish(.failed(error, advertisedName: self.peripheral.name))
    }
    timeout = work
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
  }

  private func finish(_ outcome: AccessoryHandshakeOutcome) {
    guard !finished else { return }
    finished = true
    timeout?.cancel()
    timeout = nil
    framer.reset()
    pendingChunks.removeAll()
    writeCharacteristic = nil
    peripheral.delegate = nil
    central.cancelPeripheralConnection(peripheral)
    onFinished(outcome)
  }
}
