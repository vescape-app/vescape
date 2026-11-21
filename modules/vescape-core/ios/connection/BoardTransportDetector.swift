import Foundation

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
  private let scheduler: Scheduler

  private lazy var gatt = VescGattClient(listener: self, scheduler: scheduler)
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
  private var stepWork: Cancellable?
  private var finished = false
  private var startMs: Int64 = 0

  init(
    probeId: String,
    bleId: String,
    recordDiagnostic: @escaping (String, [String: Any?]) -> Void,
    onProgress: @escaping ([String: Any?]) -> Void,
    onComplete: @escaping (TransportDetection.Result) -> Void,
    onError: @escaping (String, String) -> Void,
    nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
    scheduler: Scheduler = MainQueueScheduler()
  ) {
    self.probeId = probeId
    self.bleId = bleId
    self.recordDiagnostic = recordDiagnostic
    self.onProgress = onProgress
    self.onComplete = onComplete
    self.onError = onError
    self.nowMs = nowMs
    self.scheduler = scheduler
  }

  private func elapsed() -> Int64 { nowMs() - startMs }

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

  func onDeviceDiscovered(id: String, name: String, rssi: Int, serviceUUIDs: [String]) {}
  func onScanFailure(_ message: String) {}
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
      if phase == .probing, current != nil { markRefloatInfo(payload) }
    case COMM_FW_VERSION:
      if phase == .probing, current != nil { markFwVersion(payload) }
    case COMM_BMS_GET_VALUES:
      if phase == .probing, current != nil, parseBmsValues(payload, packetAt: nowMs()) != nil { markBms() }
    case COMM_FORWARD_CAN:
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
    sendProbeBurst(transport)
    after(PROBE_TRANSPORT_TIMEOUT_MS / 2) { [weak self] in self?.sendProbeBurst(transport) }
    armStep(PROBE_TRANSPORT_TIMEOUT_MS) { [weak self] in self?.finalizeProbe() }
  }

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

  private func after(_ ms: Int, _ block: @escaping () -> Void) {
    scheduler.postDelayed(Int64(ms), block)
  }

  private func armStep(_ ms: Int, _ action: @escaping () -> Void) {
    cancelStep()
    stepWork = scheduler.postDelayed(Int64(ms)) { [weak self] in
      guard let self else { return }
      self.stepWork = nil
      if !self.finished { action() }
    }
  }

  private func cancelStep() {
    stepWork?.cancel()
    stepWork = nil
  }

  private func completeAfterGattRelease(_ action: @escaping () -> Void) {
    scheduler.postDelayed(Int64(PROBE_GATT_RELEASE_DELAY_MS), action)
  }

  private func forwardedForCurrent(_ payload: [UInt8]) -> Bool {
    guard case .can(let canId) = current, payload.count >= 2 else { return false }
    return Int(payload[1]) == canId
  }
}
