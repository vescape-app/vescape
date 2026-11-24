import Foundation
@testable import VescapeCore

struct ConfigReplayRoutingResult {
  let values: BoardConfigValues?
  let telemetryCountDuringInFlight: Int
  let lightsDuringInFlight: [BoardLightsState]
}

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/replay/ConfigReplayHarness.kt
enum ConfigReplayHarness {
  static func decodeBoardConfigValues(_ jsonl: String) -> BoardConfigValues? {
    replayRouting(jsonl).values
  }

  static func replayRouting(
    _ jsonl: String,
    injectedDuringInFlight: [[UInt8]] = []
  ) -> ConfigReplayRoutingResult {
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

    var telemetryCount = 0
    var lights: [BoardLightsState] = []

    func route(_ packet: [UInt8], atMs: Int64) {
      let wasInFlight = controller.isInFlight
      if controller.onPayload(packet, connection: connection) { return }
      guard wasInFlight else { return }
      if let state = parseLightsControlResponse(packet) {
        lights.append(state)
        return
      }
      if parseRefloatGetAllData(payload: packet, avgLatency: nil, packetAt: atMs, pullRateHz: nil) != nil {
        telemetryCount += 1
      }
    }

    var injected = false
    let reassembler = VescPacketReassembler()
    outer: for chunk in ReplayChunkDecoder.rxChunks(jsonl) {
      for packet in reassembler.feed(chunk.bytes) {
        if capture.value != nil { break outer }
        route(packet, atMs: chunk.t)
        if !injected && controller.isInFlight {
          injected = true
          for extra in injectedDuringInFlight { route(extra, atMs: chunk.t) }
        }
      }
    }
    return ConfigReplayRoutingResult(
      values: capture.value,
      telemetryCountDuringInFlight: telemetryCount,
      lightsDuringInFlight: lights
    )
  }
}
