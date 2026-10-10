import Foundation

/// Cancellation handle for scheduled work.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/runtime/Scheduler.kt `Cancellable`
protocol Cancellable {
  func cancel()
}

/// Schedules work independently from the clock used to timestamp Board Session data.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/runtime/Scheduler.kt `Scheduler`
protocol Scheduler: AnyObject {
  @discardableResult
  func post(_ block: @escaping () -> Void) -> Cancellable

  @discardableResult
  func postDelayed(_ delayMs: Int64, _ block: @escaping () -> Void) -> Cancellable
}

private final class DispatchCancellation: Cancellable {
  private let workItem: DispatchWorkItem

  init(_ workItem: DispatchWorkItem) {
    self.workItem = workItem
  }

  func cancel() {
    workItem.cancel()
  }
}

/// Production scheduler backed by a dispatch queue.
final class DispatchQueueScheduler: Scheduler {
  private let queue: DispatchQueue

  init(queue: DispatchQueue) {
    self.queue = queue
  }

  func post(_ block: @escaping () -> Void) -> Cancellable {
    let work = DispatchWorkItem(block: block)
    queue.async(execute: work)
    return DispatchCancellation(work)
  }

  func postDelayed(_ delayMs: Int64, _ block: @escaping () -> Void) -> Cancellable {
    let work = DispatchWorkItem(block: block)
    queue.asyncAfter(deadline: .now() + Double(delayMs) / 1000.0, execute: work)
    return DispatchCancellation(work)
  }
}

/// Production scheduler for work that must run on the main queue.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/runtime/HandlerScheduler.kt `HandlerScheduler`
final class MainQueueScheduler: Scheduler {
  private let scheduler = DispatchQueueScheduler(queue: .main)

  func post(_ block: @escaping () -> Void) -> Cancellable {
    scheduler.post(block)
  }

  func postDelayed(_ delayMs: Int64, _ block: @escaping () -> Void) -> Cancellable {
    scheduler.postDelayed(delayMs, block)
  }
}

/// Virtual-time scheduler for deterministic tests.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/runtime/TestScheduler.kt `TestScheduler`
final class TestScheduler: Scheduler {
  private final class Task: Cancellable {
    let dueAt: Int64
    let sequence: Int64
    let block: () -> Void
    private(set) var isCancelled = false

    init(dueAt: Int64, sequence: Int64, block: @escaping () -> Void) {
      self.dueAt = dueAt
      self.sequence = sequence
      self.block = block
    }

    func cancel() {
      isCancelled = true
    }
  }

  private var tasks: [Task] = []
  private var sequence: Int64 = 0

  private(set) var currentTimeMs: Int64 = 0
  var pendingCount: Int { tasks.count { !$0.isCancelled } }

  func post(_ block: @escaping () -> Void) -> Cancellable {
    postDelayed(0, block)
  }

  func postDelayed(_ delayMs: Int64, _ block: @escaping () -> Void) -> Cancellable {
    let task = Task(dueAt: currentTimeMs + delayMs, sequence: sequence, block: block)
    sequence += 1
    tasks.append(task)
    return task
  }

  func advance(_ ms: Int64) {
    run(until: currentTimeMs + ms)
  }

  func runPending() {
    while let next = nextTask() {
      run(until: next.dueAt)
    }
  }

  private func run(until target: Int64) {
    while let next = nextTask(dueBy: target) {
      tasks.removeAll { $0 === next }
      currentTimeMs = next.dueAt
      next.block()
    }
    currentTimeMs = target
  }

  private func nextTask(dueBy target: Int64? = nil) -> Task? {
    tasks.removeAll { $0.isCancelled }
    return tasks
      .filter { target == nil || $0.dueAt <= target! }
      .min {
        if $0.dueAt == $1.dueAt { return $0.sequence < $1.sequence }
        return $0.dueAt < $1.dueAt
      }
  }
}

extension Scheduler {
  /// Runs delayed work only while its originating Board Session remains active and current.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/runtime/SessionGuardedScheduler.kt `postDelayedForSession`
  @discardableResult
  func postDelayedForSession(
    _ session: BoardSession,
    delayMs: Int64,
    isCurrent: @escaping (BoardSession) -> Bool,
    _ block: @escaping (BoardSession) -> Void
  ) -> Cancellable {
    postDelayed(delayMs) { [weak session] in
      guard let session, session.isActive, isCurrent(session) else { return }
      block(session)
    }
  }
}
