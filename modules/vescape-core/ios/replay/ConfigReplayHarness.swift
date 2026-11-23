import Foundation
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/replay/ConfigReplayHarness.kt
enum ConfigReplayHarness {
  static func decodeBoardConfigValues(_ jsonl: String) -> BoardConfigValues? {
    final class Capture { var value: BoardConfigValues? }
    let capture = Capture()
    let controller = ConfigRWController()
    let connection = ConfigRWConnection(
      phase: .connected,
      appBoardId: "replay",
      transport: .direct,
      fwVersion: nil,
      refloatVersion: "Refloat 3.0.7",
      refloatBaseVersion: nil,
      linkIntegrity: .trusted,
      boardConfigValues: nil,
      isPollingActive: { false },
      stopPolling: {},
      startPolling: {},
      sendPayload: { _ in true },
      captureDiagnostic: { _, _ in },
      loadProfile: { _ in nil },
      onBoardConfigValues: { values, _ in capture.value = values },
      demoteWriteBase: {},
      rideState: { BoardRideState(state: 0, switchState: 0, receivedAtMs: Int64(Date().timeIntervalSince1970 * 1000)) }
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
