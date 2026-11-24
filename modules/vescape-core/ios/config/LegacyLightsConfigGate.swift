import Foundation

internal let LIGHTS_CONFIG_ECHO_TIMEOUT_MS: Int64 = 2_000

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/LegacyLightsConfigGate.kt
internal final class LegacyLightsConfigGate {
  private let scheduler: Scheduler
  private let onEchoTimeout: () -> Void
  private let timeoutMs: Int64
  private var timeoutHandle: Cancellable?

  private(set) var isEchoPending = false

  init(
    scheduler: Scheduler,
    timeoutMs: Int64 = LIGHTS_CONFIG_ECHO_TIMEOUT_MS,
    onEchoTimeout: @escaping () -> Void
  ) {
    self.scheduler = scheduler
    self.timeoutMs = timeoutMs
    self.onEchoTimeout = onEchoTimeout
  }

  func canSendLights(refloatBaseVersion: String?, configWriteInFlight: Bool) -> Bool {
    !(lightsCommandChangesBoardConfig(refloatBaseVersion) && configWriteInFlight)
  }

  func onLightsCommandSent(refloatBaseVersion: String?) {
    guard lightsCommandChangesBoardConfig(refloatBaseVersion) else { return }
    timeoutHandle?.cancel()
    isEchoPending = true
    timeoutHandle = scheduler.postDelayed(timeoutMs) { [weak self] in
      guard let self else { return }
      self.timeoutHandle = nil
      self.isEchoPending = false
      self.onEchoTimeout()
    }
  }

  func onLightsEchoReceived() {
    timeoutHandle?.cancel()
    timeoutHandle = nil
    isEchoPending = false
  }

  func reset() {
    timeoutHandle?.cancel()
    timeoutHandle = nil
    isEchoPending = false
  }
}
