import Foundation

/// How one alert playback item ended.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/PlaybackCompletion.kt `PlaybackOutcome`
enum PlaybackOutcome: Equatable {
  case completed, cancelled, failed
}

/// Told once how a playback item ended. `AlertAudioPlayer` calls it on its audio queue.
typealias PlaybackDone = (PlaybackOutcome) -> Void

/// Longest any playback item may take before it reports `.failed`, so a lost completion (a
/// synthesizer that never calls back) never stalls the caller.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/PlaybackCompletion.kt `PLAYBACK_DONE_TIMEOUT_MS`
let playbackDoneTimeoutMs: Int64 = 30_000

/// Exactly-once wrapper around `onDone`: the first `finish` wins and is delivered through
/// `deliver`; every later one, from any thread, is dropped.
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

  /// Report `outcome`; true when this call was the one that finished the item.
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

/// Every unfinished playback item, and the one speech item (voice line or TTS) a newer one
/// pre-empts. Safe from any thread.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/PlaybackCompletion.kt `PlaybackTracker`
final class PlaybackTracker {
  private let deliver: (@escaping () -> Void) -> Void
  private var live: [ObjectIdentifier: PlaybackCompletion] = [:]
  private var speech: PlaybackCompletion?
  private let lock = NSLock()

  init(deliver: @escaping (@escaping () -> Void) -> Void) {
    self.deliver = deliver
  }

  /// A new tracked item; `cancelAll` reports it cancelled if still running.
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

  /// Make `completion` the current speech item, cancelling the one it pre-empts.
  func claimSpeech(_ completion: PlaybackCompletion) {
    lock.lock()
    let previous = speech
    speech = completion
    lock.unlock()
    if let previous, previous !== completion { previous.finish(.cancelled) }
  }

  /// True while `completion` is the current speech item.
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
