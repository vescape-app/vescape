import CoreBluetooth
import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryLink.kt `AccessoryLinkPhase`
/// @parity /modules/vescape-core/src/index.ts `AccessoryLinkPhase`
enum AccessoryLinkPhase: String {
  case idle
  case connecting
  case handshaking
  case connected
  case unavailable
  case incompatible
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryLink.kt
final class AccessoryLink {
  private static let connectTimeout: TimeInterval = 20
  private static let retryDelay: TimeInterval = 5

  let accessoryId: String

  private(set) var phase: AccessoryLinkPhase = .idle
  private(set) var lastError: String?
  private(set) var manifest: AccessoryManifest?
  private(set) var lastAckAt: TimeInterval?

  private(set) var peripheral: CBPeripheral?
  private let central: CBCentralManager
  private let onChanged: () -> Void
  private let onManifest: (AccessoryManifest, String) -> Void
  private let onReading: (AccessoryReading, TimeInterval) -> Void
  private let onSessionLost: () -> Void

  private var appliedByCapability: [String: [String: String]] = [:]

  func appliedRateHz(_ capabilityId: String) -> Double? {
    guard let text = appliedByCapability[capabilityId]?["rateHz"], let rate = Double(text),
      rate.isFinite, rate > 0
    else { return nil }
    return rate
  }

  private var writeCharacteristic: CBCharacteristic?
  private let framer = AccessoryNdjsonFramer()
  private var pendingChunks: [Data] = []
  private var writeInFlight = false
  private var started = false

  private var sessionId: String?
  private var nextRequestId = AccessorySession.firstCommandRequestId

  private var desiredOrder: [String] = []
  private var desired: [String: AccessoryCommand] = [:]

  private var lastSentAt: [String: TimeInterval] = [:]
  private var dirty: Set<String> = []

  private struct Outstanding {
    let requestId: Int
    let line: String
    var retried: Bool
  }
  private var outstanding: Outstanding?

  private var connectTimeoutWork: DispatchWorkItem?
  private var requestTimeoutWork: DispatchWorkItem?
  private var renewWork: DispatchWorkItem?
  private var retryWork: DispatchWorkItem?

  init(
    accessoryId: String,
    central: CBCentralManager,
    onChanged: @escaping () -> Void,
    onManifest: @escaping (AccessoryManifest, String) -> Void,
    onReading: @escaping (AccessoryReading, TimeInterval) -> Void = { _, _ in },
    onSessionLost: @escaping () -> Void = {}
  ) {
    self.accessoryId = accessoryId
    self.central = central
    self.onChanged = onChanged
    self.onManifest = onManifest
    self.onReading = onReading
    self.onSessionLost = onSessionLost
  }

  var deviceId: String? { peripheral?.identifier.uuidString }

  func start(peripheral: CBPeripheral?) {
    let movedHandle = peripheral != nil && peripheral?.identifier != self.peripheral?.identifier
    if movedHandle { self.peripheral = peripheral }
    guard !started || movedHandle else { return }
    started = true
    if movedHandle {
      let next = self.peripheral
      teardown()
      self.peripheral = next
    }
    connect()
  }

  /// @platform-diff Android has no equivalent hook here and re-asks on its retry timer instead.
  func onRadioAvailable() {
    guard started, peripheral != nil, phase == .connecting || phase == .idle else { return }
    retryWork?.cancel()
    retryWork = nil
    connect()
  }

  func stop() {
    started = false
    teardown()
    setPhase(.idle, error: nil)
  }

  func setDesired(_ command: AccessoryCommand) {
    if desired[command.capabilityId] == command { return }
    if desired[command.capabilityId] == nil { desiredOrder.append(command.capabilityId) }
    desired[command.capabilityId] = command
    dirty.insert(command.capabilityId)
    if phase == .connected { pump() }
  }

  private func connect() {
    guard let peripheral else { return setPhase(.idle, error: "unknown-device") }
    guard central.state == .poweredOn else {
      setPhase(.connecting, error: "bluetooth-unavailable")
      scheduleRetry()
      return
    }
    setPhase(.connecting, error: nil)
    armConnectTimeout()
    central.connect(peripheral, options: nil)
  }

  private func teardown() {
    connectTimeoutWork?.cancel(); connectTimeoutWork = nil
    requestTimeoutWork?.cancel(); requestTimeoutWork = nil
    renewWork?.cancel(); renewWork = nil
    retryWork?.cancel(); retryWork = nil
    framer.reset()
    pendingChunks.removeAll()
    writeInFlight = false
    writeCharacteristic = nil
    sessionId = nil
    outstanding = nil
    manifest = nil
    lastAckAt = nil
    appliedByCapability.removeAll()
    onSessionLost()
    if let peripheral {
      peripheral.delegate = nil
      central.cancelPeripheralConnection(peripheral)
    }
  }

  private func fail(_ error: String, phase: AccessoryLinkPhase = .unavailable) {
    let peripheral = self.peripheral
    teardown()
    self.peripheral = peripheral
    setPhase(phase, error: error)
    if started { scheduleRetry() }
  }

  private func scheduleRetry() {
    retryWork?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self, self.started else { return }
      self.connect()
    }
    retryWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.retryDelay, execute: work)
  }

  private func armConnectTimeout() {
    connectTimeoutWork?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.fail("timeout", phase: .connecting) }
    connectTimeoutWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.connectTimeout, execute: work)
  }

  private func setPhase(_ next: AccessoryLinkPhase, error: String?) {
    guard phase != next || lastError != error else { return }
    phase = next
    lastError = error
    onChanged()
  }

  func onConnected() {
    connectTimeoutWork?.cancel(); connectTimeoutWork = nil
    setPhase(.handshaking, error: nil)
    peripheral?.discoverServices([AccessoryProtocol.serviceUUID])
  }

  func onConnectFailed() { fail("connect-failed", phase: .connecting) }

  func onDisconnected() {
    framer.reset()
    pendingChunks.removeAll()
    writeInFlight = false
    writeCharacteristic = nil
    sessionId = nil
    outstanding = nil
    manifest = nil
    lastAckAt = nil
    appliedByCapability.removeAll()
    onSessionLost()
    requestTimeoutWork?.cancel(); requestTimeoutWork = nil
    renewWork?.cancel(); renewWork = nil
    guard started, let peripheral else { return setPhase(.idle, error: nil) }
    armConnectTimeout()
    setPhase(.connecting, error: nil)
    central.connect(peripheral, options: nil)
  }

  func onServicesDiscovered(error: Error?) {
    guard error == nil, let peripheral,
      let service = peripheral.services?.first(where: { $0.uuid == AccessoryProtocol.serviceUUID })
    else { return fail("service-missing") }
    peripheral.discoverCharacteristics(
      [AccessoryProtocol.writeUUID, AccessoryProtocol.notifyUUID], for: service)
  }

  func onCharacteristicsDiscovered(for service: CBService, error: Error?) {
    guard error == nil, service.uuid == AccessoryProtocol.serviceUUID,
      let peripheral,
      let characteristics = service.characteristics,
      let write = characteristics.first(where: { $0.uuid == AccessoryProtocol.writeUUID }),
      let notify = characteristics.first(where: { $0.uuid == AccessoryProtocol.notifyUUID })
    else { return fail("service-missing") }
    writeCharacteristic = write
    peripheral.setNotifyValue(true, for: notify)
  }

  func onNotifyStateChanged(for characteristic: CBCharacteristic, error: Error?) {
    guard characteristic.uuid == AccessoryProtocol.notifyUUID else { return }
    guard error == nil, characteristic.isNotifying else { return fail("service-missing") }
    sendHello()
  }

  func onWriteCompleted(error: Error?) {
    guard error == nil else { return fail("write-failed") }
    writeInFlight = false
    drain()
  }

  func onValueUpdated(for characteristic: CBCharacteristic, error: Error?) {
    guard characteristic.uuid == AccessoryProtocol.notifyUUID, error == nil,
      let value = characteristic.value, let session = sessionId
    else { return }
    let result = framer.feed([UInt8](value))
    for line in result.lines {
      if manifest == nil {
        handleHandshakeLine(line, session: session)
      } else {
        handleSessionLine(line, session: session)
      }
      guard sessionId == session else { return }
    }
    if let failure = result.failure { fail(failure.rawValue) }
  }

  private func sendHello() {
    let fresh = UUID().uuidString
    sessionId = fresh
    nextRequestId = AccessorySession.firstCommandRequestId
    outstanding = nil
    pendingChunks.removeAll()
    lastSentAt.removeAll()
    dirty.formUnion(desiredOrder)
    write(AccessoryProtocol.encodeHello(sessionId: fresh))
    armTimeout(ms: AccessoryProtocol.handshakeTimeoutMs) { [weak self] in self?.fail("timeout") }
  }

  private func handleHandshakeLine(_ line: String, session: String) {
    switch AccessoryProtocol.parseManifest(line: line, sessionId: session) {
    case .ok(let read): onManifestRead(read)
    case .failed(let reason):
      if reason != .sessionMismatch { fail(reason.rawValue) }
    }
  }

  private func onManifestRead(_ read: AccessoryManifest) {
    requestTimeoutWork?.cancel(); requestTimeoutWork = nil
    guard read.accessoryId == accessoryId else { return fail("identity-mismatch") }
    manifest = read
    if let deviceId { onManifest(read, deviceId) }
    guard read.compatibility == .supported else {
      return setPhase(.incompatible, error: read.compatibility.rawValue)
    }
    setPhase(.connected, error: nil)
    armRenewal()
    pump()
  }

  private func handleSessionLine(_ line: String, session: String) {
    switch AccessoryResponse.parse(line: line, sessionId: session) {
    case .ack(let requestId, let capabilityId, _, let applied):
      guard let pending = outstanding, pending.requestId == requestId else { return }
      requestTimeoutWork?.cancel(); requestTimeoutWork = nil
      outstanding = nil
      appliedByCapability[capabilityId] = applied
      lastAckAt = ProcessInfo.processInfo.systemUptime
      setPhase(.connected, error: nil)
      pump()

    case .failed(let requestId, let code):
      if let pending = outstanding, let requestId, requestId != pending.requestId { return }
      requestTimeoutWork?.cancel(); requestTimeoutWork = nil
      outstanding = nil
      setPhase(.unavailable, error: code)

    case .sample(let reading):
      onReading(reading, ProcessInfo.processInfo.systemUptime)

    case .malformed: fail("malformed")
    case .ignored: break
    }
  }

  private func pump() {
    guard outstanding == nil, let session = sessionId, let manifest else { return }
    let supported = Set(manifest.capabilities.filter(\.supported).map(\.id))
    let now = ProcessInfo.processInfo.systemUptime
    let interval = TimeInterval(AccessorySession.renewIntervalMs) / 1000
    guard
      let capabilityId = desiredOrder.first(where: { id in
        guard supported.contains(id) else { return false }
        if dirty.contains(id) { return true }
        guard let sent = lastSentAt[id] else { return true }
        return now - sent >= interval
      }),
      let command = desired[capabilityId]
    else { return }
    desiredOrder.removeAll { $0 == capabilityId }
    desiredOrder.append(capabilityId)
    dirty.remove(capabilityId)
    lastSentAt[capabilityId] = now
    let requestId = nextRequestId
    nextRequestId += 1
    let line = command.encode(sessionId: session, requestId: requestId)
    outstanding = Outstanding(requestId: requestId, line: line, retried: false)
    write(line)
    armTimeout(ms: AccessorySession.requestTimeoutMs) { [weak self] in self?.onRequestTimedOut() }
  }

  private func onRequestTimedOut() {
    guard var pending = outstanding else { return }
    guard !pending.retried else { return fail("timeout") }
    pending.retried = true
    outstanding = pending
    write(pending.line)
    armTimeout(ms: AccessorySession.requestTimeoutMs) { [weak self] in self?.onRequestTimedOut() }
  }

  private func armRenewal() {
    renewWork?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      if self.phase == .connected { self.pump() }
      self.armRenewal()
    }
    renewWork = work
    DispatchQueue.main.asyncAfter(
      deadline: .now() + .milliseconds(AccessorySession.renewIntervalMs), execute: work)
  }

  private func armTimeout(ms: Int, _ body: @escaping () -> Void) {
    requestTimeoutWork?.cancel()
    let work = DispatchWorkItem(block: body)
    requestTimeoutWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(ms), execute: work)
  }

  private func write(_ line: String) {
    guard let peripheral else { return }
    let payload = Data((line + "\n").utf8)
    let limit = max(peripheral.maximumWriteValueLength(for: .withResponse), 20)
    var offset = 0
    while offset < payload.count {
      let end = min(offset + limit, payload.count)
      pendingChunks.append(payload.subdata(in: offset..<end))
      offset = end
    }
    drain()
  }

  private func drain() {
    guard !writeInFlight, let peripheral, let characteristic = writeCharacteristic,
      !pendingChunks.isEmpty
    else { return }
    writeInFlight = true
    peripheral.writeValue(pendingChunks.removeFirst(), for: characteristic, type: .withResponse)
  }
}
