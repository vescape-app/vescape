import Foundation

// Re-probing a connected board tears down the live GATT and reconnects immediately; the OS
// releases the old connection asynchronously, so connecting too soon can fail. Settle before the
// first connect, then retry a bounded number of times with backoff on connect-phase drops.
private let PROBE_CONNECT_TIMEOUT_MS = 8_000
private let PROBE_HANDSHAKE_FW_DELAY_MS = 300
private let PROBE_PING_DELAY_MS = 600
private let PROBE_GATT_RELEASE_DELAY_MS = 600
private let PROBE_BMS_DELAY_MS = 300
private let PROBE_IDENTITY_FW_DELAY_MS = 600
private let PROBE_INFO_DELAY_MS = 900
private let PROBE_CONNECT_SETTLE_MS = 500
private let PROBE_CONNECT_RETRY_BACKOFF_MS = 400
private let PROBE_CONNECT_MAX_ATTEMPTS = 3
private let PROBE_CAN_PING_TIMEOUT_MS = 3_500
private let PROBE_TRANSPORT_TIMEOUT_MS = 2_500

/// BLE orchestration that runs a single Board Probe and resolves it through the pure
/// `TransportDetection` brain. It owns its own `VescGattClient` (separate `CBCentralManager`),
/// kept apart from the live Board Session so probing stays out of the runtime hot path, and
/// surfaces live milestones through `onProgress`.
///
/// Flow: connect → ping CAN (collect every responder, not just the first) → probe Direct and each
/// responder by polling telemetry and confirming a transport only once it yields a valid decoded
/// Refloat Telemetry Sample → resolve. The central runs on the main queue, so every callback and
/// timer here is single-threaded on main.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardTransportDetector.kt
/// @platform-diff iOS gets no BLE disconnect status code from CoreBluetooth, so connect-phase
/// retries key off attempt count alone.
internal final class BoardTransportDetector: VescGattListener {
  private enum Phase { case connecting, pinging, probing }

  private let probeId: String
  private let bleId: String
  private let recordDiagnostic: (String, [String: Any?]) -> Void
  private let onProgress: ([String: Any?]) -> Void
  private let onComplete: (TransportDetection.Result) -> Void
  private let onError: (String, String) -> Void
  private let nowMs: () -> Int64

  private lazy var gatt = VescGattClient(listener: self)
  private let reassembler = VescPacketReassembler()

  private var responders = Set<Int>()
  private var probeQueue: [BoardTransport] = []
  private var observations: [TransportDetection.Probe] = []
  private var current: BoardTransport?
  private var currentConfirmed = false
  private var currentHasBms = false
  private var currentVescFirmwareVersion: String?
  private var currentRefloatVersion: String?
  private var currentRefloatBaseVersion: String?
  private var connectAttempts = 0
  private var phase: Phase = .connecting
  private var stepWork: DispatchWorkItem?
  private var finished = false
  private var startMs: Int64 = 0

  init(
    probeId: String,
    bleId: String,
    recordDiagnostic: @escaping (String, [String: Any?]) -> Void,
    onProgress: @escaping ([String: Any?]) -> Void,
    onComplete: @escaping (TransportDetection.Result) -> Void,
    onError: @escaping (String, String) -> Void,
    nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
  ) {
    self.probeId = probeId
    self.bleId = bleId
    self.recordDiagnostic = recordDiagnostic
    self.onProgress = onProgress
    self.onComplete = onComplete
    self.onError = onError
    self.nowMs = nowMs
  }

  private func elapsed() -> Int64 { nowMs() - startMs }

  /// Surface live probe milestones to JS, named for what the probe is doing right now:
  /// `connecting` → `handshake` (service discovery) → `pinging` (CAN scan) → per candidate
  /// `probing` (waiting for telemetry proof) → `bms` (transport confirmed, waiting for a BMS
  /// answer) → `identity` (BMS answered, waiting for the Refloat info reply). `transport` names
  /// the candidate being probed and `canIds` the CAN scan responders. The UI still reads final
  /// facts from the returned candidates; full detail stays in Diagnostic Events.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardTransportDetector.kt `emitProgress`
  /// @parity /modules/vescape-core/src/index.ts `BoardProbeStep`
  private func emitProgress(_ step: String, transport: BoardTransport? = nil, withCanIds: Bool = false) {
    var payload: [String: Any?] = ["probeId": probeId, "step": step, "elapsedMs": elapsed()]
    if let transport { payload["transport"] = transport.bridgeValue }
    if withCanIds { payload["canIds"] = Array(responders) }
    NSLog("[VescDetect] progress step=%@ transport=%@ canIds=%@ elapsed=%dms",
          step, String(describing: transport), String(describing: responders), Int(elapsed()))
    recordProbeDiagnostic(
      "board_probe_progress",
      [
        "message": "Board Probe progress: \(step)",
        "step": step,
        "transport": transport?.bridgeValue,
        "can_ids": withCanIds ? Array(responders) : nil,
      ]
    )
    onProgress(payload)
  }

  private func recordProbeDiagnostic(_ eventName: String, _ properties: [String: Any?] = [:]) {
    recordDiagnostic(
      eventName,
      [
        "operation": "board_probe",
        "probe_id": probeId,
        "phase": String(describing: phase),
        "ble_id": bleId,
        "elapsed_ms": elapsed(),
      ].merging(properties) { _, new in new }
    )
  }

  func start() {
    startMs = nowMs()
    recordDiagnostic(
      "board_probe_started",
      ["message": "Board Probe started", "probe_id": probeId, "ble_id": bleId]
    )
    phase = .connecting
    attemptConnect(initial: true)
  }

  /// Open the probe's GATT connection after a settle delay. The first attempt waits for any
  /// just-released live connection to clear; retries back off after a transient connect-phase drop.
  private func attemptConnect(initial: Bool) {
    if finished { return }
    connectAttempts += 1
    emitProgress("connecting")
    let delay = initial ? PROBE_CONNECT_SETTLE_MS : PROBE_CONNECT_RETRY_BACKOFF_MS
    after(delay) { [weak self] in
      guard let self, !self.finished else { return }
      self.gatt.connect(peripheralId: self.bleId)
      self.armStep(PROBE_CONNECT_TIMEOUT_MS) { [weak self] in
        self?.fail(code: "PROBE_CONNECT_TIMEOUT", message: "Probe could not connect to the board")
      }
    }
  }

  // MARK: - VescGattListener (all on the main queue)

  func onDeviceDiscovered(id: String, name: String, rssi: Int, serviceUUIDs: [String]) {}
  func onScanFailure(_ message: String) {}
  /// The probe’s client is built without a restore identifier (ADR 0034) — probing is never
  /// resurrected — so its central never restores and this can never fire.
  func onGattRestored(peripheralIds: [String]) {}
  func onGattConnected() {
    recordDiagnostic(
      "board_probe_ble_connected",
      ["message": "BLE connected", "probe_id": probeId, "ble_id": bleId, "elapsed_ms": elapsed()]
    )
  }
  func onGattSubscribing() {
    if finished || phase != .connecting { return }
    emitProgress("handshake")
  }

  func onGattReady() {
    if finished || phase != .connecting { return }
    cancelStep()
    recordDiagnostic(
      "board_probe_service_ready",
      ["message": "VESC service ready", "probe_id": probeId, "elapsed_ms": elapsed()]
    )
    emitProgress("pinging")
    phase = .pinging
    after(PROBE_HANDSHAKE_FW_DELAY_MS) { [weak self] in
      guard let self, !self.finished else { return }
      _ = self.gatt.sendPayload([UInt8(COMM_FW_VERSION)])
    }
    after(PROBE_PING_DELAY_MS) { [weak self] in
      guard let self, !self.finished else { return }
      _ = self.gatt.sendPayload([UInt8(COMM_PING_CAN)])
    }
    armStep(PROBE_CAN_PING_TIMEOUT_MS) { [weak self] in self?.beginProbing() }
  }

  func onGattDisconnected(intentional: Bool, message: String) {
    if finished || intentional { return }
    if phase == .connecting {
      // Connect-phase drops are typically transient (a not-yet-released prior connection) —
      // retry a bounded number of times before giving up.
      if connectAttempts < PROBE_CONNECT_MAX_ATTEMPTS {
        cancelStep()
        recordDiagnostic(
          "board_probe_connect_retry",
          [
            "message": "Connect attempt failed, retrying",
            "probe_id": probeId,
            "attempt": connectAttempts,
            "elapsed_ms": elapsed(),
          ]
        )
        attemptConnect(initial: false)
        return
      }
      fail(code: "PROBE_DISCONNECTED", message: "Board disconnected during probe")
    } else {
      // Dropped mid-detection: resolve with whatever was confirmed so far rather than hanging.
      recordProbeDiagnostic(
        "board_probe_disconnected_mid_detection",
        [
          "message": "Board Probe disconnected mid-detection",
          "current_transport": current?.bridgeValue,
          "current_confirmed": currentConfirmed,
          "current_has_bms": currentHasBms,
          "confirmed_count": observations.filter { $0.confirmed }.count,
        ]
      )
      finalizeCurrentObservation()
      finishResolved()
    }
  }

  func onGattFailure(code: String, message: String) {
    if !finished { fail(code: code, message: message) }
  }

  func onGattFrameChunk(_ chunk: [UInt8]) {
    if finished { return }
    for payload in reassembler.feed(chunk) { handlePayload(payload) }
  }

  private func handlePayload(_ payload: [UInt8]) {
    guard !payload.isEmpty else { return }
    switch Int(payload[0]) {
    case COMM_PING_CAN:
      // Collect EVERY responding CAN id, not just payload[1].
      if phase == .pinging {
        var changed = false
        for i in 1..<payload.count {
          let inserted = responders.insert(Int(payload[i])).inserted
          changed = changed || inserted
        }
        if changed {
          recordProbeDiagnostic(
            "board_probe_can_responders_updated",
            [
              "message": "Board Probe CAN responders updated",
              "can_ids": Array(responders),
              "can_id_count": responders.count,
            ]
          )
        }
      }
    case COMM_CUSTOM_APP_DATA:
      if phase == .probing, current != nil,
        parseRefloatGetAllData(payload: payload, avgLatency: nil, packetAt: nowMs(), pullRateHz: nil) != nil {
        markConfirmed()
      }
      // Custom-app-data replies come back bare even over CAN (like telemetry
      // above), and only one transport is probed at a time, so this reply
      // belongs to the current candidate.
      if phase == .probing, current != nil { markRefloatInfo(payload) }
    case COMM_FW_VERSION:
      // FW replies also come back bare over CAN, like custom app data above.
      if phase == .probing, current != nil { markFwVersion(payload) }
    case COMM_BMS_GET_VALUES:
      // Direct smart-BMS reply.
      if phase == .probing, current != nil, parseBmsValues(payload, packetAt: nowMs()) != nil { markBms() }
    case COMM_FORWARD_CAN:
      // CAN-forwarded smart-BMS reply (telemetry stays bare, but BMS comes wrapped).
      if phase == .probing, current != nil, payload.count >= 3, forwardedForCurrent(payload) {
        if Int(payload[2]) == COMM_FW_VERSION {
          markFwVersion(Array(payload[2...]))
        }
        markRefloatInfo(payload)
        if Int(payload[2]) == COMM_BMS_GET_VALUES,
          parseBmsValues(Array(payload[2...]), packetAt: nowMs()) != nil {
          markBms()
        }
      }
    default:
      break
    }
  }

  // MARK: - Probe sequencing

  private func beginProbing() {
    if finished { return }
    phase = .probing
    probeQueue = TransportDetection.candidatesToProbe(Array(responders))
    probeNext()
  }

  private func probeNext() {
    cancelStep()
    currentConfirmed = false
    currentHasBms = false
    currentVescFirmwareVersion = nil
    currentRefloatVersion = nil
    currentRefloatBaseVersion = nil
    guard !probeQueue.isEmpty else {
      current = nil
      finishResolved()
      return
    }
    let transport = probeQueue.removeFirst()
    current = transport
    emitProgress("probing", transport: transport, withCanIds: true)
    recordDiagnostic(
      "board_probe_transport_probe_started",
      [
        "message": "Probing transport",
        "probe_id": probeId,
        "transport": transport.bridgeValue,
        "elapsed_ms": elapsed(),
      ]
    )
    // Ask for telemetry (confirms the transport) and BMS values (capability) in one window. The
    // BMS reply is best-effort: absence within the window means no BMS.
    sendProbeBurst(transport)
    // Re-send once mid-window in case the first request dropped.
    after(PROBE_TRANSPORT_TIMEOUT_MS / 2) { [weak self] in self?.sendProbeBurst(transport) }
    armStep(PROBE_TRANSPORT_TIMEOUT_MS) { [weak self] in self?.finalizeProbe() }
  }

  /// Send the telemetry then BMS request, staggered so each write lands rather than the second
  /// dropping a false "no BMS".
  private func sendProbeBurst(_ transport: BoardTransport) {
    if finished || current != transport { return }
    _ = gatt.sendPayload(transport.frame([
      UInt8(COMM_CUSTOM_APP_DATA), UInt8(REFLOAT_MAGIC), UInt8(REFLOAT_GET_ALLDATA), 2,
    ]))
    after(PROBE_BMS_DELAY_MS) { [weak self] in
      guard let self, !self.finished, self.current == transport else { return }
      _ = self.gatt.sendPayload(transport.frame([UInt8(COMM_BMS_GET_VALUES)]))
    }
    after(PROBE_IDENTITY_FW_DELAY_MS) { [weak self] in
      guard let self, !self.finished, self.current == transport else { return }
      _ = self.gatt.sendPayload(transport.frame([UInt8(COMM_FW_VERSION)]))
    }
    after(PROBE_INFO_DELAY_MS) { [weak self] in
      guard let self, !self.finished, self.current == transport else { return }
      _ = self.gatt.sendPayload(RefloatConfigProtocol.buildGetInfo(transport: transport))
    }
  }

  /// Telemetry sample proves the transport works; the window now waits on BMS —
  /// unless the BMS reply already raced in first, then it waits on identity.
  private func markConfirmed() {
    if currentConfirmed { return }
    currentConfirmed = true
    recordProbeDiagnostic(
      "board_probe_telemetry_confirmed",
      [
        "message": "Board Probe telemetry confirmed transport",
        "transport": current?.bridgeValue,
        "can_ids": Array(responders),
      ]
    )
    emitProgress(currentHasBms ? "identity" : "bms", transport: current, withCanIds: true)
  }

  /// A smart-BMS answered on the current transport; the window now waits on identity.
  /// Burst replies race, so only advance once telemetry confirmed — an early BMS
  /// reply is recorded and reported when the confirm lands.
  private func markBms() {
    if currentHasBms { return }
    currentHasBms = true
    recordProbeDiagnostic(
      "board_probe_bms_detected",
      [
        "message": "Board Probe detected smart-BMS",
        "transport": current?.bridgeValue,
      ]
    )
    if currentConfirmed { emitProgress("identity", transport: current, withCanIds: true) }
  }

  private func markFwVersion(_ payload: [UInt8]) {
    guard let firmware = parseFwVersion(payload: payload) else { return }
    currentVescFirmwareVersion = firmware
    recordProbeDiagnostic(
      "board_probe_firmware_detected",
      [
        "message": "Board Probe detected VESC firmware",
        "transport": current?.bridgeValue,
        "vesc_firmware_version": firmware,
      ]
    )
  }

  private func markRefloatInfo(_ payload: [UInt8]) {
    switch RefloatConfigProtocol.parseGetInfoResponse(payload) {
    case .success(let info):
      currentRefloatVersion = info.version
      currentRefloatBaseVersion = RefloatConfigProtocol.normalizeBaseVersion(info.version)
      recordProbeDiagnostic(
        "board_probe_refloat_detected",
        [
          "message": "Board Probe detected Refloat identity",
          "transport": current?.bridgeValue,
          "refloat_version": currentRefloatVersion,
          "refloat_base_version": currentRefloatBaseVersion,
        ]
      )
    case .failure:
      break
    }
  }

  private func finalizeProbe() {
    finalizeCurrentObservation()
    probeNext()
  }

  private func finalizeCurrentObservation() {
    guard let transport = current else { return }
    cancelStep()
    observations.append(
      TransportDetection.Probe(
        transport: transport,
        confirmed: currentConfirmed,
        hasBms: currentHasBms,
        vescFirmwareVersion: currentVescFirmwareVersion,
        refloatVersion: currentRefloatVersion,
        refloatBaseVersion: currentRefloatBaseVersion
      )
    )
    recordProbeDiagnostic(
      "board_probe_transport_finished",
      [
        "message": currentConfirmed ? "Board Probe transport finished confirmed" : "Board Probe transport finished unconfirmed",
        "transport": transport.bridgeValue,
        "confirmed": currentConfirmed,
        "has_bms": currentHasBms,
        "vesc_firmware_version": currentVescFirmwareVersion,
        "refloat_version": currentRefloatVersion,
        "refloat_base_version": currentRefloatBaseVersion,
      ]
    )
    if currentConfirmed {
      recordDiagnostic(
        "board_probe_transport_confirmed",
        [
          "message": "Transport confirmed by telemetry sample",
          "probe_id": probeId,
          "transport": transport.bridgeValue,
          "has_bms": currentHasBms,
          "vesc_firmware_version": currentVescFirmwareVersion,
          "refloat_version": currentRefloatVersion,
          "refloat_base_version": currentRefloatBaseVersion,
          "elapsed_ms": elapsed(),
        ]
      )
    }
    current = nil
  }

  private func finishResolved() {
    if finished { return }
    let result = TransportDetection.resolve(observations)
    let outcome: String
    switch result.outcome {
    case .resolved: outcome = "resolved"
    case .needsPick: outcome = "needs-pick"
    case .none: outcome = "none"
    }
    recordDiagnostic(
      "board_probe_completed",
      [
        "message": "Board Probe completed",
        "probe_id": probeId,
        "candidate_count": result.candidates.count,
        "outcome": outcome,
        "elapsed_ms": elapsed(),
      ]
    )
    emitProgress("completed")
    cleanup()
    completeAfterGattRelease { [onComplete] in onComplete(result) }
  }

  private func fail(code: String, message: String) {
    if finished { return }
    recordDiagnostic(
      "board_probe_failed",
      ["message": message, "probe_id": probeId, "code": code, "elapsed_ms": elapsed()]
    )
    emitProgress("failed")
    cleanup()
    completeAfterGattRelease { [onError] in onError(code, message) }
  }

  func cancel(reason: String = "cancelled") {
    if finished { return }
    recordProbeDiagnostic(
      "board_probe_cancelled",
      [
        "message": "Board Probe cancelled",
        "reason": reason,
      ]
    )
    cleanup()
  }

  private func cleanup() {
    finished = true
    cancelStep()
    gatt.disconnect()
  }

  // MARK: - Timers (main queue)

  private func after(_ ms: Int, _ block: @escaping () -> Void) {
    DispatchQueue.main.asyncAfter(deadline: .now() + Double(ms) / 1000.0, execute: block)
  }

  private func armStep(_ ms: Int, _ action: @escaping () -> Void) {
    cancelStep()
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.stepWork = nil
      if !self.finished { action() }
    }
    stepWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + Double(ms) / 1000.0, execute: work)
  }

  private func cancelStep() {
    stepWork?.cancel()
    stepWork = nil
  }

  private func completeAfterGattRelease(_ action: @escaping () -> Void) {
    DispatchQueue.main.asyncAfter(
      deadline: .now() + Double(PROBE_GATT_RELEASE_DELAY_MS) / 1000.0,
      execute: action
    )
  }

  private func forwardedForCurrent(_ payload: [UInt8]) -> Bool {
    guard case .can(let canId) = current, payload.count >= 2 else { return false }
    return Int(payload[1]) == canId
  }
}
