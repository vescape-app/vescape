import CoreBluetooth
import Foundation

/// What one handshake produced, ready to cross the bridge.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryGattHandshake.kt `AccessoryHandshakeOutcome`
enum AccessoryHandshakeOutcome {
  case ok(AccessoryManifest, advertisedName: String?)
  case failed(String, advertisedName: String?)
}

/// One Accessory discovery handshake: connect, subscribe, write `hello`, read the manifest back,
/// disconnect. Nothing else is ever written on the link.
///
/// That single-write shape is the guarantee behind "no control activates from discovery": the class
/// has no path that can emit `configure` or `state`, so inspecting an Accessory cannot start a
/// measurement or change a light. The operational session is a separate concern built on top of the
/// same protocol in later slices.
///
/// Short-lived by design — it is torn down the moment it has an answer, so discovery never holds a
/// connection an Accessory's real session would have to fight for.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryGattHandshake.kt
final class AccessoryGattHandshake {
  /// Connect, discover and subscribe must all land before the handshake is even sent.
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

  // MARK: - Central callbacks, forwarded by `AccessoryDiscovery`

  func onConnected() {
    peripheral.discoverServices([AccessoryProtocol.serviceUUID])
  }

  func onDisconnected() {
    finish(.failed("connect-failed", advertisedName: peripheral.name))
  }

  func onConnectFailed() {
    finish(.failed("connect-failed", advertisedName: peripheral.name))
  }

  // MARK: - Peripheral callbacks

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
        // A message from another session is noise on a shared characteristic, not a protocol
        // violation: keep waiting for the manifest this hello asked for.
        if reason != .sessionMismatch {
          return finish(.failed(reason.rawValue, advertisedName: peripheral.name))
        }
      }
    }
    if let failure = result.failure {
      finish(.failed(failure.rawValue, advertisedName: peripheral.name))
    }
  }

  // MARK: - Internals

  /// Subscribed and ready: write the one line discovery is allowed to send.
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
    // The clock starts at the request, not at connect: a slow connect has its own budget.
    arm(TimeInterval(AccessoryProtocol.handshakeTimeoutMs) / 1000, error: "timeout")
    drain()
  }

  /// One outstanding write at a time; the chunks of one line stay in order.
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
