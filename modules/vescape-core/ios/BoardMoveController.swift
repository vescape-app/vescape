import Foundation

/// Refresh interval for the 1.3+ `REMOTE` input byte, which firmware lapses after ~1s of silence.
/// The packet only carries a value, so re-sending it often is free.
private let BOARD_MOVE_REMOTE_REPEAT_MS = 100

/// Refresh interval for the 1.0–1.2 `RC_MOVE` command. That packet is a *duration* request carrying
/// `RC_MOVE_TIME_STEPS` (~1s of run time), and firmware zeroes its move current and ramps it back to
/// the target on every request. So both extremes stutter: repeating on the 1.3+ cadence restarts the
/// ramp ten times a second, and repeating slower than the request's own life leaves silent gaps.
/// Re-send inside that life, rarely enough that the ramp restart stays a dip rather than the signal.
private let BOARD_MOVE_RC_MOVE_REPEAT_MS = 700

private func boardMoveRepeatMs(_ generation: BoardMoveGeneration) -> Int {
  switch generation {
  case .remote: return BOARD_MOVE_REMOTE_REPEAT_MS
  case .rcMove: return BOARD_MOVE_RC_MOVE_REPEAT_MS
  }
}

/// Streams Refloat's Board Move input: motor output while the board is disengaged. This is not
/// Remote Tilt — it never touches the tilt setpoint and never writes config.
///
/// The rider holds a direction button and the board keeps moving until release, so the held input is
/// repeated on a tick chosen per generation (both firmware generations drop the request after ~1s of
/// silence, but only the 1.3+ packet tolerates a fast refresh — see `boardMoveRepeatMs`). Releasing
/// sends a neutral stop so the board halts immediately instead of coasting to the firmware timeout.
///
/// Firmware owns the safety envelope: 1.0–1.2 `cmd_rc_move` and 1.3+ `remote_command_input` both
/// apply output only from the ready (disengaged) state, and 1.3+ additionally holds a 2s grace after
/// disengaging.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/BoardMoveController.kt
/// @platform-diff iOS has no replaceable remote-input write slot, so writes go through the plain
/// payload path and the stop input is not prioritised ahead of queued telemetry polls.
internal final class BoardMoveController {
  /// Supplies the active transport only while the session can talk to the board; `nil` otherwise.
  private let transport: () -> BoardTransport?
  /// Whether move commands are allowed at all (trusted link). Re-checked every tick, so a link that
  /// loses trust mid-hold is stopped with a neutral rather than left streaming.
  private let canMove: () -> Bool
  /// Picks the wire format from the linked Refloat version.
  private let generation: () -> BoardMoveGeneration
  private let send: (_ payload: [UInt8]) -> Bool
  private let schedule: (_ delayMs: Int, _ block: @escaping () -> Void) -> DispatchWorkItem

  private var input: Int?
  private var repeatWork: DispatchWorkItem?

  init(
    transport: @escaping () -> BoardTransport?,
    canMove: @escaping () -> Bool,
    generation: @escaping () -> BoardMoveGeneration,
    send: @escaping (_ payload: [UInt8]) -> Bool,
    schedule: @escaping (_ delayMs: Int, _ block: @escaping () -> Void) -> DispatchWorkItem = {
      delayMs, block in
      let work = DispatchWorkItem(block: block)
      DispatchQueue.main.asyncAfter(deadline: .now() + Double(delayMs) / 1000.0, execute: work)
      return work
    }
  ) {
    self.transport = transport
    self.canMove = canMove
    self.generation = generation
    self.send = send
    self.schedule = schedule
  }

  /// The input currently being streamed (`-127...127`), or `nil` when idle.
  var currentInput: Int? { input }

  var isMoving: Bool { input != nil }

  /// Hold a constant move input until `stop()`. `input` is `-127...127`; `0` is treated as a stop.
  @discardableResult
  func hold(_ input: Int) -> Bool {
    let clamped = min(max(input, -BOARD_MOVE_INPUT_MAX), BOARD_MOVE_INPUT_MAX)
    if clamped == 0 { return stop() }
    guard canMove(), let transport = transport() else { return false }

    // A running loop picks the new input up on its next tick; changing direction mid-hold must not
    // schedule an extra write.
    let alreadyStreaming = repeatWork != nil
    self.input = clamped
    if alreadyStreaming { return true }

    let generation = generation()
    let sent = send(buildBoardMoveCommand(transport: transport, generation: generation, input: clamped))
    scheduleRepeat(generation: generation)
    return sent
  }

  @discardableResult
  func stop() -> Bool {
    let wasMoving = input != nil
    clear()
    if let transport = transport() {
      _ = send(buildBoardMoveCommand(transport: transport, generation: generation(), input: 0))
    }
    return wasMoving
  }

  private func scheduleRepeat(generation: BoardMoveGeneration) {
    repeatWork = schedule(boardMoveRepeatMs(generation)) { [weak self] in
      guard let self else { return }
      guard let input = self.input, let transport = self.transport() else {
        self.clear()
        return
      }
      guard self.canMove() else {
        self.stop()
        return
      }
      let generation = self.generation()
      _ = self.send(buildBoardMoveCommand(transport: transport, generation: generation, input: input))
      self.scheduleRepeat(generation: generation)
    }
  }

  private func clear() {
    input = nil
    repeatWork?.cancel()
    repeatWork = nil
  }
}
