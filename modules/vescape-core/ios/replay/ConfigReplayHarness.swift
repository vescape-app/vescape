import Foundation
@testable import VescapeCore

/// Config-scoped Board Warning replay harness (ADR 0024): reconstructs the Refloat config read from a
/// `.jsonl` Debug Recording by driving the **real** `ConfigRWController` with the recorded `rx`
/// packets, then returns the decoded `BoardConfigValues` the config-safety detector evaluates.
/// Nothing is re-implemented: the same reassembler, protocol parser, schema parser, and config
/// decoder the live session uses run here; only the transport (request sending) and side effects are
/// stubbed, exactly as the transport-seam replay does for the telemetry-scoped detectors.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/replay/ConfigReplayHarness.kt
enum ConfigReplayHarness {
  /// Board Config Values decoded from the recording's config read, or nil when the recording holds
  /// no completable config exchange (the config-scoped detector then evaluates nothing).
  static func decodeBoardConfigValues(_ jsonl: String) -> BoardConfigValues? {
    final class Capture { var value: BoardConfigValues? }
    let capture = Capture()
    let controller = ConfigRWController()
    let connection = ConfigRWConnection(
      phase: .connected,
      appBoardId: "replay",
      transport: .direct,
      fwVersion: nil,
      refloatBaseVersion: nil,
      linkIntegrity: .trusted,
      isPollingActive: { false },
      stopPolling: {},
      startPolling: {},
      // The controller drives a live request/response loop; replay supplies the responses from the
      // recording, so its outgoing frames and diagnostics are swallowed. Only the decode result matters.
      sendPayload: { _ in true },
      captureDiagnostic: { _, _ in },
      loadProfile: { _ in nil },
      onBoardConfigValues: { capture.value = $0 }
    )
    controller.consumeRead(connection: connection, onSuccess: { _ in }, onError: { _, _ in })

    let reassembler = VescPacketReassembler()
    outer: for chunk in ReplayChunkDecoder.rxChunks(jsonl) {
      for packet in reassembler.feed(chunk.bytes) {
        if capture.value != nil { break outer }
        _ = controller.onPayload(packet, connection: connection)
      }
    }
    return capture.value
  }
}
