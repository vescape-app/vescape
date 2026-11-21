import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/PlaybackCompletion.kt `PlaybackOutcome`
enum PlaybackOutcome: Equatable {
  case completed, cancelled, failed
}

typealias PlaybackDone = (PlaybackOutcome) -> Void

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/PlaybackCompletion.kt `PLAYBACK_DONE_TIMEOUT_MS`
let playbackDoneTimeoutMs: Int64 = 30_000

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/PlaybackCompletion.kt `PlaybackCompletion`
final class PlaybackCompletion {
  private let deliver: (@escaping () -> Void) -> Void
  private var pending: PlaybackDone?
  private let lock = NSLock()

  init(deliver: @escaping (@escaping () -> Void) -> Void, onDone: @escaping PlaybackDone) {
    self.deliver = deliver
    pending = onDone
  }

  var isDone: Bool {
    lock.lock()
    defer { lock.unlock() }
    return pending == nil
  }

  @discardableResult
  func finish(_ outcome: PlaybackOutcome) -> Bool {
    lock.lock()
    let done = pending
    pending = nil
    lock.unlock()
    guard let done else { return false }
    deliver { done(outcome) }
    return true
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/PlaybackCompletion.kt `PlaybackTracker`
final class PlaybackTracker {
  private let deliver: (@escaping () -> Void) -> Void
  private var live: [ObjectIdentifier: PlaybackCompletion] = [:]
  private var speech: PlaybackCompletion?
  private let lock = NSLock()

  init(deliver: @escaping (@escaping () -> Void) -> Void) {
    self.deliver = deliver
  }

  func start(_ onDone: @escaping PlaybackDone) -> PlaybackCompletion {
    var id: ObjectIdentifier?
    let completion = PlaybackCompletion(deliver: deliver) { [weak self] outcome in
      if let self, let id {
        self.lock.lock()
        self.live[id] = nil
        self.lock.unlock()
      }
      onDone(outcome)
    }
    id = ObjectIdentifier(completion)
    lock.lock()
    live[ObjectIdentifier(completion)] = completion
    lock.unlock()
    return completion
  }

  func claimSpeech(_ completion: PlaybackCompletion) {
    lock.lock()
    let previous = speech
    speech = completion
    lock.unlock()
    if let previous, previous !== completion { previous.finish(.cancelled) }
  }

  func isSpeech(_ completion: PlaybackCompletion) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return speech === completion && !completion.isDone
  }

  func cancelAll() {
    lock.lock()
    let all = Array(live.values)
    speech = nil
    lock.unlock()
    for completion in all { completion.finish(.cancelled) }
  }
}
