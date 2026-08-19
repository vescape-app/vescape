import Foundation

/// Rider-visible Presence Scan phase. Mirrors `LiveStateEvent.presence.phase`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardPresenceScan.kt `PresenceScanPhase`
internal enum PresenceScanPhase: String {
  case idle
  /// Started, but the radio is not usable yet. The five-second window has not begun.
  case waitingForBluetooth = "waiting_for_bluetooth"
  case scanning
  case done
}

/// Everything JS renders about the current or last Presence Scan. Native owns every field.
internal struct PresenceScanState {
  var phase: PresenceScanPhase = .idle
  var purpose: ScanPurpose?
  var owner: ConnectionOwner = .none
  var startedAtMs: Int64?
  var deadlineAtMs: Int64?
  var observations: [PresenceObservation] = []
  var decision: String?
  var reason: String?

  var map: [String: Any?] {
    [
      "phase": phase.rawValue,
      "purpose": purpose?.wireValue,
      "owner": owner.wireValue,
      "startedAt": startedAtMs,
      "deadlineAt": deadlineAtMs,
      "observations": observations.map { $0.map },
      "decision": decision,
      "reason": reason,
    ]
  }
}

/// Delayed work seam, so the five-second deadline is testable without waiting five seconds.
internal protocol PresenceScheduler {
  func post(_ block: @escaping () -> Void)
  func postDelayed(_ delayMs: Int64, _ block: @escaping () -> Void) -> () -> Void
}

/// Main-queue scheduler used in the app.
internal struct MainPresenceScheduler: PresenceScheduler {
  func post(_ block: @escaping () -> Void) {
    DispatchQueue.main.async(execute: block)
  }

  func postDelayed(_ delayMs: Int64, _ block: @escaping () -> Void) -> () -> Void {
    let item = DispatchWorkItem(block: block)
    DispatchQueue.main.asyncAfter(deadline: .now() + Double(delayMs) / 1000.0, execute: item)
    return { item.cancel() }
  }
}

/// The radio, as the Presence Scan needs it. Everything platform-specific lives behind this seam so
/// the scan's ordering, deadline, and decisions are testable without Bluetooth.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardPresenceScan.kt `PresenceScanPort`
internal protocol PresenceScanPort {
  func bluetoothEnabled() -> Bool
  func scanPermissionGranted() -> Bool
  func scannerAvailable() -> Bool
  /// Begin scanning. `onReady` fires when the radio is actually usable — the five-second deadline
  /// starts there, not at foreground entry. Returns false when the scan could not be started.
  func startScan(
    onReady: @escaping () -> Void,
    onObserved: @escaping (String, Int?) -> Void,
    onFailed: @escaping (String) -> Void
  ) -> Bool
  func stopScan()
}

/// Board Presence Scan (ADR 0035). One scan per foreground entry: it watches the saved BLE ids of
/// every linked Board for five seconds after the radio becomes usable, promotes the selected Board
/// into a Board Session when policy allows, and reports every non-selected Board it saw without ever
/// connecting it (#408 turns those into switch-and-connect hints).
///
/// Stale BLE callbacks are rejected by the `ScannerCoordinator` operation token rather than by
/// guessing from surrounding state.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardPresenceScan.kt
internal final class BoardPresenceScan {
  private let port: PresenceScanPort
  private let scanner: ScannerCoordinator
  private let ownership: ConnectionOwnership
  private let scheduler: PresenceScheduler
  private let nowMs: () -> Int64
  private let windowMs: Int64
  private let onStateChanged: (PresenceScanState) -> Void
  private let onPromote: (PresenceTarget) -> Void

  private(set) var state = PresenceScanState()
  private var operation: ScanOperation?
  private var cancelDeadline: (() -> Void)?
  private var targets: [PresenceTarget] = []
  private var workflow: ConnectionWorkflow?
  private var promotionInput: (() -> PresencePromotionInput)?

  var isRunning: Bool { operation != nil }

  init(
    port: PresenceScanPort,
    scanner: ScannerCoordinator = .shared,
    ownership: ConnectionOwnership = .shared,
    scheduler: PresenceScheduler = MainPresenceScheduler(),
    nowMs: @escaping () -> Int64 = { ConnectionTrace.now() },
    windowMs: Int64 = presenceScanWindowMs,
    onStateChanged: @escaping (PresenceScanState) -> Void = { _ in },
    onPromote: @escaping (PresenceTarget) -> Void = { _ in }
  ) {
    self.port = port
    self.scanner = scanner
    self.ownership = ownership
    self.scheduler = scheduler
    self.nowMs = nowMs
    self.windowMs = windowMs
    self.onStateChanged = onStateChanged
    self.onPromote = onPromote
  }

  /// Run one Presence Scan. `promotionInput` is read at match time rather than now, so a setting or
  /// Automatic Connection Pause that changes mid-scan still decides the outcome.
  @discardableResult
  func start(
    environment: PresenceScanEnvironment,
    targets: [PresenceTarget],
    workflow: ConnectionWorkflow? = nil,
    promotionInput: @escaping () -> PresencePromotionInput
  ) -> PresenceScanDecision {
    if isRunning {
      return refuse(
        workflow,
        PresenceScanDecision(
          proceed: false,
          decision: ConnectionTraceDecision.skipped,
          reason: ConnectionTraceReason.scannerBusy
        )
      )
    }

    let eligibility = PresenceScanPolicy.evaluate(environment)
    guard eligibility.proceed else { return refuse(workflow, eligibility) }

    guard case let .granted(granted) = scanner.acquire(.presence) else {
      return refuse(
        workflow,
        PresenceScanDecision(
          proceed: false,
          decision: ConnectionTraceDecision.skipped,
          reason: ConnectionTraceReason.scannerBusy
        )
      )
    }

    let ownershipDecision = ownership.request(.autoConnect)
    guard ownershipDecision.granted else {
      scanner.release(granted)
      workflow?.event(
        ConnectionTraceEvent.ownerDenied,
        fields: [
          ConnectionTraceField.ownerRequested: ConnectionOwner.autoConnect.wireValue,
          ConnectionTraceField.ownerPrevious: ownershipDecision.previousOwner.wireValue,
        ]
      )
      return refuse(
        workflow,
        PresenceScanDecision(
          proceed: false,
          decision: ConnectionTraceDecision.denied,
          reason: ownershipDecision.reason
        )
      )
    }
    _ = workflow?.handoff(owner: ConnectionOwner.autoConnect.wireValue)
    workflow?.event(
      ConnectionTraceEvent.ownerGranted,
      fields: [ConnectionTraceField.ownerPrevious: ownershipDecision.previousOwner.wireValue]
    )

    operation = granted
    self.targets = targets
    self.workflow = workflow
    self.promotionInput = promotionInput
    publish(
      PresenceScanState(
        phase: .waitingForBluetooth,
        purpose: .presence,
        owner: .autoConnect,
        startedAtMs: nowMs()
      )
    )
    workflow?.event(
      ConnectionTraceEvent.presenceScanStarted,
      fields: [
        ConnectionTraceField.scanPurpose: ScanPurpose.presence.wireValue,
        ConnectionTraceField.deadlineMs: windowMs,
        ConnectionTraceField.boardId: environment.selectedBoardId,
      ]
    )

    let started = port.startScan(
      onReady: { [weak self] in self?.guarded(granted) { self?.onReady() } },
      onObserved: { [weak self] bleId, rssi in self?.guarded(granted) { self?.onObserved(bleId, rssi) } },
      onFailed: { [weak self] message in self?.guarded(granted) { self?.onFailed(message) } }
    )
    guard started else {
      fail(reason: ConnectionTraceReason.scannerUnavailable, message: "scan start refused")
      return PresenceScanDecision(
        proceed: false,
        decision: ConnectionTraceDecision.failed,
        reason: ConnectionTraceReason.scannerUnavailable
      )
    }
    return PresenceScanDecision(proceed: true, decision: ConnectionTraceDecision.granted, reason: nil)
  }

  /// Radio usable: the five-second window starts here, never at foreground entry.
  private func onReady() {
    let deadlineAt = PresenceScanPolicy.deadlineAt(readyAtMs: nowMs(), windowMs: windowMs)
    state.phase = .scanning
    state.deadlineAtMs = deadlineAt
    publish(state)
    workflow?.event(
      ConnectionTraceEvent.presenceScanReady,
      fields: [
        ConnectionTraceField.deadlineAt: deadlineAt,
        ConnectionTraceField.deadlineMs: windowMs,
      ]
    )
    cancelDeadline?()
    cancelDeadline = scheduler.postDelayed(windowMs) { [weak self] in self?.onDeadline() }
  }

  private func onObserved(_ bleId: String, _ rssi: Int?) {
    guard let target = targets.first(where: { $0.bleId.caseInsensitiveCompare(bleId) == .orderedSame })
    else { return }
    let observation = PresenceObservation(
      boardId: target.boardId,
      bleId: target.bleId,
      name: target.name,
      rssi: rssi,
      observedAtMs: nowMs(),
      selected: target.selected
    )
    // Deduplicate by saved Board id. A repeated advertisement refreshes the existing observation in
    // place — that is what makes expiry "thirty seconds after the *last* advertisement" — and never
    // queues a second hint for the same Board.
    let upsert = AlternativeHints.upsert(state.observations, observation)
    var next = state
    next.observations = upsert.observations
    publish(next)
    guard upsert.isNew else { return }
    workflow?.event(
      ConnectionTraceEvent.presenceScanObserved,
      fields: [
        ConnectionTraceField.boardId: observation.boardId,
        ConnectionTraceField.bleId: observation.bleId,
        ConnectionTraceField.rssi: observation.rssi,
        ConnectionTraceField.observationCount: state.observations.count,
      ]
    )
    // A non-selected Board is reported, never connected. The scan keeps running so its own Board can
    // still turn up before the deadline.
    if target.selected {
      resolveMatch(target)
    } else {
      workflow?.event(
        ConnectionTraceEvent.alternativeHintOffered,
        fields: [
          ConnectionTraceField.boardId: observation.boardId,
          ConnectionTraceField.bleId: observation.bleId,
          ConnectionTraceField.boardNickname: observation.name,
          ConnectionTraceField.rssi: observation.rssi,
        ]
      )
    }
  }

  private func resolveMatch(_ target: PresenceTarget) {
    workflow?.event(
      ConnectionTraceEvent.presenceScanMatched,
      fields: [
        ConnectionTraceField.boardId: target.boardId,
        ConnectionTraceField.bleId: target.bleId,
      ]
    )
    guard var input = promotionInput?() else { return }
    input.selectedObserved = true
    let promotion = PresenceScanPolicy.promotion(input)
    stopScanning()
    state.phase = .done
    state.decision = promotion.decision
    state.reason = promotion.reason
    publish(state)
    if promotion.proceed {
      workflow?.event(
        ConnectionTraceEvent.autoConnectPromoted,
        fields: [ConnectionTraceField.boardId: target.boardId]
      )
      // Hand ownership straight to the Board Session; the session's teardown releases it.
      ownership.release(.autoConnect)
      ownership.request(.boardSession)
      _ = workflow?.handoff(owner: ConnectionOwner.boardSession.wireValue)
      workflow?.finish(decision: ConnectionTraceDecision.completed, reason: ConnectionTraceReason.matched)
      onPromote(target)
    } else {
      workflow?.event(
        ConnectionTraceEvent.autoConnectSkipped,
        fields: [
          ConnectionTraceField.boardId: target.boardId,
          ConnectionTraceField.reason: promotion.reason,
        ]
      )
      releaseOwnership()
      workflow?.finish(
        decision: promotion.decision,
        reason: promotion.reason ?? ConnectionTraceReason.boardNotPresent
      )
    }
    workflow = nil
  }

  private func onDeadline() {
    stopScanning()
    state.phase = .done
    state.decision = ConnectionTraceDecision.timeout
    state.reason = ConnectionTraceReason.boardNotPresent
    publish(state)
    workflow?.event(
      ConnectionTraceEvent.presenceScanTimeout,
      fields: [ConnectionTraceField.observationCount: state.observations.count]
    )
    releaseOwnership()
    workflow?.finish(decision: ConnectionTraceDecision.timeout, reason: ConnectionTraceReason.deadlineExpired)
    workflow = nil
  }

  private func onFailed(_ message: String) {
    fail(reason: ConnectionTraceReason.platformError, message: message)
  }

  /// Give the scanner up for an exclusive owner, an explicit Connect, or app teardown.
  func cancel(reason: String = ConnectionTraceReason.userCancelled) {
    guard isRunning else { return }
    stopScanning()
    state.phase = .done
    state.decision = ConnectionTraceDecision.cancelled
    state.reason = reason
    publish(state)
    workflow?.event(ConnectionTraceEvent.presenceScanCancelled, fields: [ConnectionTraceField.reason: reason])
    releaseOwnership()
    workflow?.finish(decision: ConnectionTraceDecision.cancelled, reason: reason)
    workflow = nil
  }

  private func fail(reason: String, message: String) {
    stopScanning()
    state.phase = .done
    state.decision = ConnectionTraceDecision.failed
    state.reason = reason
    publish(state)
    workflow?.event(
      ConnectionTraceEvent.presenceScanFailed,
      fields: [ConnectionTraceField.reason: reason, "message": message]
    )
    releaseOwnership()
    workflow?.finish(decision: ConnectionTraceDecision.failed, reason: reason)
    workflow = nil
  }

  private func refuse(
    _ workflow: ConnectionWorkflow?,
    _ decision: PresenceScanDecision
  ) -> PresenceScanDecision {
    publish(
      PresenceScanState(
        phase: .idle,
        purpose: .presence,
        decision: decision.decision,
        reason: decision.reason
      )
    )
    workflow?.event(
      ConnectionTraceEvent.presenceScanSkipped,
      fields: [ConnectionTraceField.reason: decision.reason]
    )
    workflow?.finish(
      decision: decision.decision,
      reason: decision.reason ?? ConnectionTraceReason.platformError
    )
    return decision
  }

  /// Run `block` only while `expected` still owns the scanner. Late BLE callbacks die here.
  private func guarded(_ expected: ScanOperation, _ block: @escaping () -> Void) {
    scheduler.post { [weak self] in
      guard let self, self.scanner.isCurrent(expected), self.operation?.token == expected.token else {
        return
      }
      block()
    }
  }

  private func stopScanning() {
    cancelDeadline?()
    cancelDeadline = nil
    port.stopScan()
    scanner.release(operation)
    operation = nil
    promotionInput = nil
  }

  private func releaseOwnership() {
    if ownership.release(.autoConnect) {
      workflow?.event(
        ConnectionTraceEvent.ownerReleased,
        fields: [ConnectionTraceField.ownerPrevious: ConnectionOwner.autoConnect.wireValue]
      )
    }
  }

  private func publish(_ next: PresenceScanState) {
    state = next
    onStateChanged(next)
  }
}
