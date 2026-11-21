import Foundation

private let BOARD_MOVE_REMOTE_REPEAT_MS = 100

private let BOARD_MOVE_RC_MOVE_REPEAT_MS = 700

private func boardMoveRepeatMs(_ generation: BoardMoveGeneration) -> Int {
  switch generation {
  case .remote: return BOARD_MOVE_REMOTE_REPEAT_MS
  case .rcMove: return BOARD_MOVE_RC_MOVE_REPEAT_MS
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/BoardMoveController.kt
internal final class BoardMoveController {
  private let transport: () -> BoardTransport?
  private let canMove: () -> Bool
  private let generation: () -> BoardMoveGeneration
  private let send: (_ payload: [UInt8], _ urgent: Bool) -> Bool
  private let scheduler: Scheduler

  private var input: Int?
  private var repeatWork: Cancellable?

  init(
    transport: @escaping () -> BoardTransport?,
    canMove: @escaping () -> Bool,
    generation: @escaping () -> BoardMoveGeneration,
    send: @escaping (_ payload: [UInt8], _ urgent: Bool) -> Bool,
    scheduler: Scheduler = MainQueueScheduler()
  ) {
    self.transport = transport
    self.canMove = canMove
    self.generation = generation
    self.send = send
    self.scheduler = scheduler
  }

  var currentInput: Int? { input }

  var isMoving: Bool { input != nil }

  @discardableResult
  func hold(_ input: Int) -> Bool {
    let clamped = min(max(input, -BOARD_MOVE_INPUT_MAX), BOARD_MOVE_INPUT_MAX)
    if clamped == 0 { return stop() }
    guard canMove(), let transport = transport() else { return false }

    let alreadyStreaming = repeatWork != nil
    self.input = clamped
    if alreadyStreaming { return true }

    let generation = generation()
    let sent = send(
      buildBoardMoveCommand(transport: transport, generation: generation, input: clamped), false)
    scheduleRepeat(generation: generation)
    return sent
  }

  @discardableResult
  func stop() -> Bool {
    let wasMoving = input != nil
    clear()
    if let transport = transport() {
      _ = send(
        buildBoardMoveCommand(transport: transport, generation: generation(), input: 0), true)
    }
    return wasMoving
  }

  private func scheduleRepeat(generation: BoardMoveGeneration) {
    repeatWork = scheduler.postDelayed(Int64(boardMoveRepeatMs(generation))) { [weak self] in
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
      _ = self.send(
        buildBoardMoveCommand(transport: transport, generation: generation, input: input), false)
      self.scheduleRepeat(generation: generation)
    }
  }

  private func clear() {
    input = nil
    repeatWork?.cancel()
    repeatWork = nil
  }
}
