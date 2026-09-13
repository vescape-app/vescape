import CoreBluetooth
import Foundation

/// Where one enrolled Accessory's link stands. Native decides this; JS renders it and never derives
/// one from a boolean, exactly as it does for a Board.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryLink.kt `AccessoryLinkPhase`
/// @parity /modules/vescape-core/src/index.ts `AccessoryLinkPhase`
enum AccessoryLinkPhase: String {
  /// No link is held and none is being attempted.
  case idle
  /// The radio is trying, including while CoreBluetooth holds an open-ended connect.
  case connecting
  /// GATT is up; the manifest has not been validated yet.
  case handshaking
  /// Manifest validated and the session's commands are being acknowledged.
  case connected
  /// It answered, but the session could not be kept: refused or unacknowledged commands.
  case unavailable
  /// Its manifest says this app cannot drive it. Nothing is commanded; the row explains why.
  case incompatible
}

/// A live protocol session with one enrolled Accessory.
///
/// Long-lived, unlike `AccessoryGattHandshake`: this is the link an Accessory keeps while the rider
/// is riding, the screen is off and the JS runtime is gone. CoreBluetooth's open-ended
/// `connect(_:)` is what carries it across a walk out of range, so being dropped is not an error
/// and does not reset anything durable.
///
/// Every connection is a **fresh protocol session**. A new session id goes out with the hello, the
/// request counter restarts, and the desired commands are re-sent from scratch — so a command
/// queued against the previous session can never reach this one, and an ack belonging to it is
/// ignored rather than matched against the wrong request.
///
/// Timers are `DispatchQueue.main.asyncAfter` deadlines, which run on the monotonic uptime clock.
/// Leases and request timeouts are durations, and wall clock moves under them (NTP, time zones, the
/// rider changing the date); a lease measured on the wrong clock is a light that goes dark at
/// midnight.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryLink.kt
final class AccessoryLink {
  /// How long to wait for a connection before reporting the accessory unreachable. CoreBluetooth
  /// itself never gives up, so this only exists to keep the row honest.
  private static let connectTimeout: TimeInterval = 20
  /// Backoff between deliberate reconnect attempts after the link failed rather than merely dropped.
  private static let retryDelay: TimeInterval = 5

  /// Manifest identity this link is for. A manifest naming anything else is refused.
  let accessoryId: String

  private(set) var phase: AccessoryLinkPhase = .idle
  /// Wire string for the last failure, or nil while nothing is wrong.
  private(set) var lastError: String?
  /// Manifest read on the current connection. Nil whenever no session is established.
  private(set) var manifest: AccessoryManifest?
  /// Monotonic timestamp of the last ack, for the lease the accessory is holding.
  private(set) var lastAckAt: TimeInterval?

  private(set) var peripheral: CBPeripheral?
  private let central: CBCentralManager
  private let onChanged: () -> Void
  private let onManifest: (AccessoryManifest, String) -> Void

  private var writeCharacteristic: CBCharacteristic?
  private let framer = AccessoryNdjsonFramer()
  private var pendingChunks: [Data] = []
  private var writeInFlight = false
  private var started = false

  private var sessionId: String?
  private var nextRequestId = AccessorySession.firstCommandRequestId

  /// Desired state per capability, in insertion order. Coalesced: only the latest matters, because
  /// commands are absolute.
  private var desiredOrder: [String] = []
  private var desired: [String: AccessoryCommand] = [:]

  private struct Outstanding {
    let requestId: Int
    let line: String
    /// False until the one permitted retry has gone out with the same id.
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
    onManifest: @escaping (AccessoryManifest, String) -> Void
  ) {
    self.accessoryId = accessoryId
    self.central = central
    self.onChanged = onChanged
    self.onManifest = onManifest
  }

  var deviceId: String? { peripheral?.identifier.uuidString }

  /// Starts, or re-points at a newly discovered peripheral. Idempotent.
  func start(peripheral: CBPeripheral?) {
    if let peripheral, peripheral.identifier != self.peripheral?.identifier {
      if started { teardown() }
      self.peripheral = peripheral
    }
    guard !started else { return }
    started = true
    connect()
  }

  func stop() {
    started = false
    teardown()
    setPhase(.idle, error: nil)
  }

  /// Sets the desired state for one capability.
  ///
  /// Absolute, never incremental: the accessory is told what to be, so the same call repeated is
  /// the renewal and a dropped one costs nothing but latency. An unchanged command is not re-queued
  /// — the renewal tick already re-sends it, and re-queueing would burn a request id per call.
  func setDesired(_ command: AccessoryCommand) {
    if desired[command.capabilityId] == command { return }
    if desired[command.capabilityId] == nil { desiredOrder.append(command.capabilityId) }
    desired[command.capabilityId] = command
    // A changed state goes out immediately rather than waiting for the next renewal tick.
    if phase == .connected { pump() }
  }

  // MARK: - Connection

  private func connect() {
    guard let peripheral else { return setPhase(.idle, error: "unknown-device") }
    guard central.state == .poweredOn else {
      setPhase(.connecting, error: "bluetooth-unavailable")
      return
    }
    setPhase(.connecting, error: nil)
    armConnectTimeout()
    // No timeout option: CoreBluetooth keeps the attempt alive across the Accessory going out of
    // range and back, without the app holding a scan. This is the whole reason a session survives a
    // dead JS runtime, and with state restoration it survives the process too.
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
    if let peripheral {
      peripheral.delegate = nil
      central.cancelPeripheralConnection(peripheral)
    }
  }

  /// A failed link is rebuilt from scratch rather than resumed: a broken session has no state worth
  /// keeping.
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

  // MARK: - Central callbacks, forwarded by `AccessorySessionController`

  func onConnected() {
    connectTimeoutWork?.cancel(); connectTimeoutWork = nil
    setPhase(.handshaking, error: nil)
    // The delegate is the controller's, assigned when it handed this peripheral over; it routes
    // every peripheral callback back here by identifier.
    peripheral?.discoverServices([AccessoryProtocol.serviceUUID])
  }

  func onConnectFailed() { fail("connect-failed", phase: .connecting) }

  func onDisconnected() {
    // A drop is not a failure: CoreBluetooth keeps trying on its own, so the session is discarded
    // but the link stays armed and the row says "connecting".
    framer.reset()
    pendingChunks.removeAll()
    writeInFlight = false
    writeCharacteristic = nil
    sessionId = nil
    outstanding = nil
    manifest = nil
    lastAckAt = nil
    requestTimeoutWork?.cancel(); requestTimeoutWork = nil
    renewWork?.cancel(); renewWork = nil
    guard started, let peripheral else { return setPhase(.idle, error: nil) }
    armConnectTimeout()
    setPhase(.connecting, error: nil)
    central.connect(peripheral, options: nil)
  }

  // MARK: - Peripheral callbacks

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

  // MARK: - Protocol session

  private func sendHello() {
    let fresh = UUID().uuidString
    sessionId = fresh
    // A new session starts its request numbering over, which is exactly what makes an old queue
    // harmless: nothing from the previous session shares a (session, request) pair.
    nextRequestId = AccessorySession.firstCommandRequestId
    outstanding = nil
    pendingChunks.removeAll()
    write(AccessoryProtocol.encodeHello(sessionId: fresh))
    armTimeout(ms: AccessoryProtocol.handshakeTimeoutMs) { [weak self] in self?.fail("timeout") }
  }

  private func handleHandshakeLine(_ line: String, session: String) {
    switch AccessoryProtocol.parseManifest(line: line, sessionId: session) {
    case .ok(let read): onManifestRead(read)
    case .failed(let reason):
      // Another session's message is noise on a shared characteristic, not a violation.
      if reason != .sessionMismatch { fail(reason.rawValue) }
    }
  }

  private func onManifestRead(_ read: AccessoryManifest) {
    requestTimeoutWork?.cancel(); requestTimeoutWork = nil
    // Identity is checked before anything saved is trusted. A different accessory answering on a
    // remembered handle is a stale handle, never a reason to drive someone else's hardware.
    guard read.accessoryId == accessoryId else { return fail("identity-mismatch") }
    manifest = read
    if let deviceId { onManifest(read, deviceId) }
    guard read.compatibility == .supported else {
      // Read, recognised, and deliberately left alone: an accessory this app cannot drive stays
      // connected only long enough to say so.
      return setPhase(.incompatible, error: read.compatibility.rawValue)
    }
    setPhase(.connected, error: nil)
    armRenewal()
    pump()
  }

  private func handleSessionLine(_ line: String, session: String) {
    switch AccessoryResponse.parse(line: line, sessionId: session) {
    case .ack(let requestId, _, _, _):
      guard let pending = outstanding, pending.requestId == requestId else { return }
      requestTimeoutWork?.cancel(); requestTimeoutWork = nil
      outstanding = nil
      lastAckAt = ProcessInfo.processInfo.systemUptime
      setPhase(.connected, error: nil)
      pump()

    case .failed(let requestId, let code):
      if let pending = outstanding, let requestId, requestId != pending.requestId { return }
      requestTimeoutWork?.cancel(); requestTimeoutWork = nil
      outstanding = nil
      // The refusal is the accessory's answer, not a broken link: stay connected and say what it
      // refused, rather than dropping a session that is otherwise healthy.
      setPhase(.unavailable, error: code)

    case .malformed: fail("malformed")
    case .ignored: break
    }
  }

  // MARK: - Request pump

  /// Sends the next desired command that is not already the one outstanding.
  private func pump() {
    guard outstanding == nil, let session = sessionId, let manifest else { return }
    let supported = Set(manifest.capabilities.filter(\.supported).map(\.id))
    guard let capabilityId = desiredOrder.first(where: { supported.contains($0) }),
      let command = desired[capabilityId]
    else { return }
    // Round-robin: the capability just sent goes to the back, so one capability cannot starve
    // another's renewal.
    desiredOrder.removeAll { $0 == capabilityId }
    desiredOrder.append(capabilityId)
    let requestId = nextRequestId
    nextRequestId += 1
    let line = command.encode(sessionId: session, requestId: requestId)
    outstanding = Outstanding(requestId: requestId, line: line, retried: false)
    write(line)
    armTimeout(ms: AccessorySession.requestTimeoutMs) { [weak self] in self?.onRequestTimedOut() }
  }

  /// One retry with the *same* request id, then the accessory is unavailable.
  ///
  /// Reusing the id is the point: the accessory recognises a duplicate and replays its previous
  /// answer instead of applying the command twice, so a retry cannot restart an animation or extend
  /// a lease twice.
  private func onRequestTimedOut() {
    guard var pending = outstanding else { return }
    guard !pending.retried else { return fail("timeout") }
    pending.retried = true
    outstanding = pending
    write(pending.line)
    armTimeout(ms: AccessorySession.requestTimeoutMs) { [weak self] in self?.onRequestTimedOut() }
  }

  /// Re-sends the current desired state often enough that the accessory's lease never lapses while
  /// the app is alive and willing. Nothing here is incremental: a renewal is the same absolute
  /// command, so a missed tick costs latency and not correctness.
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

  // MARK: - Writing

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

  /// One outstanding write at a time; the chunks of one line stay in order.
  private func drain() {
    guard !writeInFlight, let peripheral, let characteristic = writeCharacteristic,
      !pendingChunks.isEmpty
    else { return }
    writeInFlight = true
    peripheral.writeValue(pendingChunks.removeFirst(), for: characteristic, type: .withResponse)
  }
}
