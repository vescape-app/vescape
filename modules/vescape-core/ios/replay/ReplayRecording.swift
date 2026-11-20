import Foundation

/// One payload at its recorded offset.
internal struct TimedPayload {
  let t: Int64
  let payload: [UInt8]
}

/// What plays on a `SimulatedBoard`'s timeline, by recorded offset.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/ReplayRecording.kt `ReplayEvent`
internal enum ReplayEvent {
  /// A board frame nothing asked for, or one the app polls for: telemetry, BMS, anything unknown.
  case frame(t: Int64, payload: [UInt8])
  case fix(ReplayLocation)
  /// A config write the app made during the recorded ride; the board holds it from here on.
  case configWrite(t: Int64, payload: [UInt8])

  var t: Int64 {
    switch self {
    case let .frame(t, _): return t
    case let .fix(fix): return fix.t
    case let .configWrite(t, _): return t
    }
  }
}

/// The hardware a recording was made on. A replay presents it as the Board's link, so Link Integrity
/// judges the recorded board on its own answers (ADR 0048).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/ReplayRecording.kt `RecordedHardware`
internal struct RecordedHardware: Equatable {
  let deviceId: String?
  let transport: BoardTransport
  let firmware: String?
  let refloatVersion: String?
  let hasBms: Bool
  let pollIntervalMs: Int?
}

/// The replies a recording holds, indexed by what they answer rather than paired with the request
/// that produced them: replies describe themselves in their header, while the app asks at different
/// moments than the recorded session did.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/ReplayRecording.kt `ReplyBook`
internal struct ReplyBook {
  let firmware: [UInt8]?
  let refloatInfo: [UInt8]?
  let motorConfig: [UInt8]?
  /// The custom config XML, reassembled from every chunk the recording saw, keyed by `confInd`.
  let configXml: [Int: [UInt8]]
  /// Recorded `COMM_GET_CUSTOM_CONFIG` replies per `confInd`, in time order.
  let configSnapshots: [Int: [TimedPayload]]
}

/// A Debug Recording decoded for a `SimulatedBoard`: the hardware it was made on, the timeline the
/// board plays on its own, and the replies it gives when asked.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/ReplayRecording.kt
internal struct ReplayRecording {
  let name: String
  let hardware: RecordedHardware
  let timeline: [ReplayEvent]
  let replies: ReplyBook

  var durationMs: Int64 { timeline.last?.t ?? 0 }

  static func parse(name: String, jsonl: String) -> ReplayRecording {
    let meta = jsonl.split(separator: "\n", maxSplits: 1).first.flatMap(metaOrNil)
    var frames: [ReplayEvent] = []
    var firmware: [UInt8]?
    var refloatInfo: [UInt8]?
    var motorConfig: [UInt8]?
    var hasBms = false
    var xml: [Int: [UInt8]] = [:]
    var snapshots: [Int: [TimedPayload]] = [:]

    let rx = VescPacketReassembler()
    for chunk in ReplayChunkDecoder.rxChunks(jsonl) {
      for packet in rx.feed(chunk.bytes) {
        guard let payload = unwrapCan(packet) else { continue }
        switch Int(payload[0]) {
        case COMM_FW_VERSION: firmware = firmware ?? payload
        case COMM_GET_MCCONF: motorConfig = motorConfig ?? payload
        case COMM_GET_CUSTOM_CONFIG_XML: addXmlChunk(&xml, payload)
        case COMM_GET_CUSTOM_CONFIG:
          if payload.count > 1 {
            snapshots[Int(payload[1]), default: []].append(TimedPayload(t: chunk.t, payload: payload))
          }
        // Acks and echoes are the board's answers to this session's own writes.
        case COMM_SET_CUSTOM_CONFIG: break
        case COMM_CUSTOM_APP_DATA:
          switch refloatCommand(payload) {
          case REFLOAT_GET_INFO: refloatInfo = refloatInfo ?? payload
          case REFLOAT_LIGHTS_CONTROL, REFLOAT_LIGHTS_CONTROL_LEGACY: break
          default: frames.append(.frame(t: chunk.t, payload: payload))
          }
        default:
          if Int(payload[0]) == COMM_BMS_GET_VALUES { hasBms = true }
          frames.append(.frame(t: chunk.t, payload: payload))
        }
      }
    }

    var recordedCanId: Int?
    let tx = VescPacketReassembler()
    for chunk in ReplayChunkDecoder.txChunks(jsonl) {
      for packet in tx.feed(chunk.bytes) {
        if packet.count >= 2, Int(packet[0]) == COMM_FORWARD_CAN {
          recordedCanId = recordedCanId ?? Int(packet[1])
        }
        guard let payload = unwrapCan(packet) else { continue }
        if Int(payload[0]) == COMM_SET_CUSTOM_CONFIG {
          frames.append(.configWrite(t: chunk.t, payload: payload))
        }
      }
    }

    let fixes = ReplayChunkDecoder.locations(jsonl).map(ReplayEvent.fix)
    let transport = BoardTransport.decode((meta?["transport"] as? String).flatMap { $0.isEmpty ? nil : $0 })
      ?? recordedCanId.map(BoardTransport.can)
      ?? .direct
    let refloatVersion: String? = refloatInfo.flatMap {
      switch RefloatConfigProtocol.parseGetInfoResponse($0) {
      case let .success(info): return info.version
      case .failure: return nil
      }
    }
    let pollIntervalMs = (meta?["pollIntervalMs"] as? NSNumber)?.intValue
    return ReplayRecording(
      name: name,
      hardware: RecordedHardware(
        deviceId: (meta?["deviceId"] as? String).flatMap { $0.isEmpty ? nil : $0 },
        transport: transport,
        firmware: firmware.flatMap { parseFwVersion(payload: $0) },
        refloatVersion: refloatVersion,
        hasBms: hasBms,
        pollIntervalMs: pollIntervalMs.flatMap { $0 > 0 ? $0 : nil }
      ),
      // Stable: a fix and a frame at the same offset keep file order.
      timeline: stableSorted(frames + fixes),
      replies: ReplyBook(
        firmware: firmware,
        refloatInfo: refloatInfo,
        motorConfig: motorConfig,
        configXml: xml,
        configSnapshots: snapshots
      )
    )
  }

  /// Strip a `COMM_FORWARD_CAN` envelope; CAN boards usually answer unwrapped anyway.
  static func unwrapCan(_ packet: [UInt8]) -> [UInt8]? {
    guard !packet.isEmpty else { return nil }
    guard Int(packet[0]) == COMM_FORWARD_CAN else { return packet }
    return packet.count > 2 ? Array(packet[2...]) : nil
  }

  static func refloatCommand(_ payload: [UInt8]) -> Int? {
    payload.count >= 3 && Int(payload[0]) == COMM_CUSTOM_APP_DATA && Int(payload[1]) == REFLOAT_MAGIC
      ? Int(payload[2])
      : nil
  }

  private static func metaOrNil(_ line: Substring) -> [String: Any]? {
    guard
      let data = line.data(using: .utf8),
      // intentional-suppression: a recording without a readable meta line replays with defaults
      let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      json["kind"] as? String == "meta"
    else { return nil }
    return json
  }

  private static func stableSorted(_ events: [ReplayEvent]) -> [ReplayEvent] {
    events.enumerated()
      .sorted { $0.element.t != $1.element.t ? $0.element.t < $1.element.t : $0.offset < $1.offset }
      .map(\.element)
  }

  private static func addXmlChunk(_ xml: inout [Int: [UInt8]], _ payload: [UInt8]) {
    guard payload.count > 1 else { return }
    let chunk: RefloatConfigXmlChunk
    switch RefloatConfigProtocol.parseCustomConfigXmlResponse(payload, expectedConfInd: Int(payload[1])) {
    case let .success(value): chunk = value
    case .failure: return
    }
    var bytes = xml[chunk.confInd].flatMap { $0.count == chunk.totalLength ? $0 : nil }
      ?? [UInt8](repeating: 0, count: chunk.totalLength)
    // The parser has already bounded the chunk inside `totalLength`.
    bytes.replaceSubrange(chunk.offset..<(chunk.offset + chunk.chunk.count), with: chunk.chunk)
    xml[chunk.confInd] = bytes
  }
}
