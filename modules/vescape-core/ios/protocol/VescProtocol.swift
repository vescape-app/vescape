import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescProtocol.kt
private let REFLOAT_FAULT_MODE = 69
internal let COMM_FW_VERSION = 0
internal let COMM_FORWARD_CAN = 34
internal let COMM_CUSTOM_APP_DATA = 36
internal let COMM_BMS_GET_VALUES = 96
internal let COMM_GET_MCCONF = 14
internal let COMM_GET_CUSTOM_CONFIG_XML = 92
internal let COMM_GET_CUSTOM_CONFIG = 93
internal let COMM_SET_CUSTOM_CONFIG = 95
internal let COMM_PING_CAN = 62
internal let COMM_SET_CHUCK_DATA = 35

/// Read-only terminal request. Vescape only ever sends the fixed literal `faults`; the command
/// byte is deliberately not exposed with a caller-supplied string anywhere.
internal let COMM_TERMINAL_CMD = 20

/// Controller terminal output. Multi-frame, with no explicit completion frame.
internal let COMM_PRINT = 21
internal let REFLOAT_MAGIC = 101
internal let REFLOAT_GET_INFO = 0
internal let REFLOAT_GET_ALLDATA = 10
internal let REFLOAT_RC_MOVE = 7
internal let REFLOAT_REMOTE = 15
internal let REFLOAT_LIGHTS_CONTROL = 20
internal let REMOTE_TILT_CENTER = 128

/// The one and only terminal command Vescape sends. VESC's `faults` command prints the controller's
/// retained in-memory fault register and mutates nothing. Keeping it a private constant behind
/// `buildFaultsTerminalCommand` is what stops this from becoming a generic command surface.
private let vescFaultsTerminalCommand = "faults"

/// Frames the read-only `faults` terminal request for the Board Link's transport, so a CAN-forwarded
/// Refloat Board asks the same controller the Board Link proved.
///
/// There is intentionally **no** string parameter: the payload is fixed.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescProtocol.kt `buildFaultsTerminalCommand`
internal func buildFaultsTerminalCommand(_ transport: BoardTransport) -> [UInt8] {
  transport.frame([UInt8(COMM_TERMINAL_CMD)] + Array(vescFaultsTerminalCommand.utf8))
}

/// Which light switches a `LIGHTS_CONTROL` request addresses: bit 0 the lights as a whole, bit 1 the
/// headlights. Firmware only applies the bits the mask names, so writing both is what makes this an
/// all-or-nothing switch rather than a partial edit of whatever the board had.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescProtocol.kt `LIGHTS_CONTROL_MASK`
private let LIGHTS_CONTROL_MASK = 0x3

/// Board lights as the board reports them back on its `LIGHTS_CONTROL` echo.
internal struct BoardLightsState: Equatable {
  let enabled: Bool
  let headlightsEnabled: Bool
}

/// Builds the Refloat lights switch: turns the LEDs and headlights on or off together. Runtime only —
/// firmware applies it live and never writes config, so a power cycle restores the board's own
/// setting. The write is sticky for the rest of that power cycle: firmware marks the runtime value
/// as overriding the configured one, so later config changes to the lights stop taking effect live.
///
/// A board with its LEDs configured off still accepts the command and echoes back `enabled` — the
/// runtime flag flips, there is just nothing to light up. `GET_INFO` capabilities bit 0 is how a
/// client knows not to offer the switch at all.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescProtocol.kt `buildLightsControlCommand`
internal func buildLightsControlCommand(transport: BoardTransport, enabled: Bool) -> [UInt8] {
  let value = enabled ? LIGHTS_CONTROL_MASK : 0
  return transport.frame([
    UInt8(COMM_CUSTOM_APP_DATA),
    UInt8(REFLOAT_MAGIC),
    UInt8(REFLOAT_LIGHTS_CONTROL),
    // mask, uint32 big-endian
    0,
    0,
    0,
    UInt8(LIGHTS_CONTROL_MASK),
    UInt8(value),
  ])
}

/// Decodes the board's `LIGHTS_CONTROL` echo, the authoritative answer to what the switch did.
/// Returns `nil` for any payload that is not one, including the CAN-forwarded form.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescProtocol.kt `parseLightsControlResponse`
internal func parseLightsControlResponse(_ payload: [UInt8]) -> BoardLightsState? {
  let body: [UInt8]
  if payload.count >= 4, Int(payload[0]) == COMM_CUSTOM_APP_DATA {
    body = payload
  } else if payload.count >= 6, Int(payload[0]) == COMM_FORWARD_CAN {
    body = Array(payload[2...])
  } else {
    return nil
  }
  guard body.count >= 4,
    Int(body[1]) == REFLOAT_MAGIC,
    Int(body[2]) == REFLOAT_LIGHTS_CONTROL
  else { return nil }
  return BoardLightsState(enabled: body[3] & 0x1 != 0, headlightsEnabled: body[3] & 0x2 != 0)
}

/// Board Move input range for the Refloat 1.3+ `REMOTE` byte (`-128` is ignored by firmware).
internal let BOARD_MOVE_INPUT_MAX = 127

/// Motor current a full-scale `RC_MOVE` request asks for, in tenths of an amp.
private let RC_MOVE_CURRENT_MAX_DECIAMPS = 60

/// How long one `RC_MOVE` request runs. `time` is not seconds: firmware runs the request for
/// `time * 100` control-loop steps, and that loop ticks at ~832 Hz, so one unit is only ~120 ms.
/// Eight units cover ~1s, which outlives the controller's repeat tick — a request that lapses before
/// its re-send lands is exactly what makes the motor stutter.
private let RC_MOVE_TIME_STEPS = 8

/// Which Refloat command carries app-driven Board Move for a given firmware.
///
/// Refloat 1.3 replaced the current/time `RC_MOVE` payload with a single signed remote-input byte,
/// so the wire format is chosen from the linked base version.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescProtocol.kt `BoardMoveGeneration`
/// @parity /modules/vescape-core/src/index.ts `startBoardMove`
internal enum BoardMoveGeneration {
  /// Refloat 1.0–1.2: `RC_MOVE` with explicit current and time bytes.
  case rcMove

  /// Refloat 1.3+: `REMOTE` with one signed input byte.
  case remote

  /// Resolves the generation from a normalized Refloat base version such as `"1.2.0"`. Unknown or
  /// unparseable versions fall back to `.remote`: a wrong guess only means the board ignores the
  /// command.
  static func forBaseVersion(_ baseVersion: String?) -> BoardMoveGeneration {
    let parts = baseVersion?.split(separator: ".") ?? []
    guard let major = parts.first.flatMap({ Int($0) }) else { return .remote }
    let minor = parts.count > 1 ? Int(parts[1]) ?? 0 : 0
    return (major > 1 || (major == 1 && minor >= 3)) ? .remote : .rcMove
  }
}

/// Builds a Board Move command: motor output while the board is disengaged, not tilt. `input` is
/// `-127...127`, where `0` stops. Firmware applies it only in the ready (disengaged) state and
/// clamps the resulting output itself.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescProtocol.kt `buildBoardMoveCommand`
internal func buildBoardMoveCommand(
  transport: BoardTransport,
  generation: BoardMoveGeneration,
  input: Int
) -> [UInt8] {
  precondition(
    (-BOARD_MOVE_INPUT_MAX...BOARD_MOVE_INPUT_MAX).contains(input),
    "Board move input must be between -\(BOARD_MOVE_INPUT_MAX) and \(BOARD_MOVE_INPUT_MAX)"
  )
  let payload: [UInt8]
  switch generation {
  case .remote:
    payload = [
      UInt8(COMM_CUSTOM_APP_DATA),
      UInt8(REFLOAT_MAGIC),
      UInt8(REFLOAT_REMOTE),
      UInt8(bitPattern: Int8(input)),
    ]
  case .rcMove:
    let direction: UInt8 = input >= 0 ? 1 : 0
    let current = abs(input) * RC_MOVE_CURRENT_MAX_DECIAMPS / BOARD_MOVE_INPUT_MAX
    let time = current == 0 ? 1 : RC_MOVE_TIME_STEPS
    payload = [
      UInt8(COMM_CUSTOM_APP_DATA),
      UInt8(REFLOAT_MAGIC),
      UInt8(REFLOAT_RC_MOVE),
      direction,
      UInt8(current),
      UInt8(time),
      UInt8(current + time),
    ]
  }
  return transport.frame(payload)
}

internal enum VescUartUUIDs {
  static let service = UUID(uuidString: "6e400001-b5a3-f393-e0a9-e50e24dcca9e")!
  static let tx = UUID(uuidString: "6e400002-b5a3-f393-e0a9-e50e24dcca9e")!
  static let rx = UUID(uuidString: "6e400003-b5a3-f393-e0a9-e50e24dcca9e")!
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardTransport.kt
/// Persisted form (`boards.transport` TEXT scalar): `null` | `"direct"` | `"<canId>"`.
/// Bridge form (JS): `null` | `"direct"` | Int.
internal enum BoardTransport: Equatable {
  case direct
  case can(Int)

  func frame(_ command: [UInt8]) -> [UInt8] {
    switch self {
    case .direct:
      return command
    case .can(let canId):
      precondition((0...255).contains(canId), "CAN id must be between 0 and 255")
      return [UInt8(COMM_FORWARD_CAN), UInt8(canId)] + command
    }
  }

  /// Wire scalar for JS: `"direct"` or a CAN id. Mirrors `BoardTransport.toBridge`.
  var bridgeValue: Any {
    switch self {
    case .direct: return "direct"
    case .can(let canId): return canId
    }
  }

  /// Coerce a bridge value coming from JS (`null` | `"direct"` | Number). Junk → `nil`
  /// (undetected). Mirrors Android `BoardTransport.fromBridge`.
  static func fromBridge(_ value: Any?) -> BoardTransport? {
    switch value {
    case let text as String where text == "direct":
      return .direct
    case let number as NSNumber:
      let canId = number.intValue
      return (0...255).contains(canId) ? .can(canId) : nil
    default:
      return nil
    }
  }

  /// Decode the persisted TEXT column. Junk decodes to `nil` (undetected).
  /// Mirrors Android `BoardTransport.decode`.
  static func decode(_ stored: String?) -> BoardTransport? {
    switch stored {
    case nil:
      return nil
    case "direct":
      return .direct
    case let text?:
      guard let canId = Int(text), (0...255).contains(canId) else { return nil }
      return .can(canId)
    }
  }

  /// Encode to the persisted TEXT column. Mirrors Android `BoardTransport.encode`.
  static func encode(_ transport: BoardTransport?) -> String? {
    switch transport {
    case nil: return nil
    case .direct: return "direct"
    case .can(let canId): return String(canId)
    }
  }
}

internal func buildRemoteTiltCommand(transport: BoardTransport, value: Int) -> [UInt8] {
  precondition((0...255).contains(value), "Remote tilt value must be between 0 and 255")
  return transport.frame([
    UInt8(COMM_SET_CHUCK_DATA),
    0,
    UInt8(255 - value),
  ])
}

internal func parseFwVersion(payload: [UInt8]) -> String? {
  guard payload.count >= 3 else { return nil }
  let major = Int(payload[1])
  let minor = Int(payload[2])
  var hardwareNameEnd = 3
  while hardwareNameEnd < payload.count && payload[hardwareNameEnd] != 0 {
    hardwareNameEnd += 1
  }

  let hardwareName: String?
  if hardwareNameEnd > 3 {
    hardwareName = String(bytes: payload[3..<hardwareNameEnd], encoding: .utf8)
  } else {
    hardwareName = nil
  }

  var offset = hardwareNameEnd + 1 + 15
  var customConfigs: [String] = []
  if offset < payload.count {
    let count = Int(payload[offset])
    offset += 1
    for _ in 0..<count {
      let start = offset
      while offset < payload.count && payload[offset] != 0 {
        offset += 1
      }
      if offset > start, let config = String(bytes: payload[start..<offset], encoding: .utf8) {
        customConfigs.append(config)
      }
      offset += 1
    }
  }

  var parts = ["FW \(major).\(String(format: "%02d", minor))"]
  if let hardwareName {
    parts.append(hardwareName)
  }
  if !customConfigs.isEmpty {
    parts.append(customConfigs.joined(separator: ", "))
  }
  return parts.joined(separator: " · ")
}

internal enum VescPacketCodec {
  static func buildPacket(_ payload: [UInt8]) -> [UInt8] {
    let short = payload.count <= 255
    var frame: [UInt8] = []
    frame.reserveCapacity((short ? 2 : 3) + payload.count + 3)

    if short {
      frame.append(0x02)
      frame.append(UInt8(payload.count))
    } else {
      frame.append(0x03)
      frame.append(UInt8((payload.count >> 8) & 0xff))
      frame.append(UInt8(payload.count & 0xff))
    }

    frame.append(contentsOf: payload)
    let crc = crc16(payload)
    frame.append(UInt8((crc >> 8) & 0xff))
    frame.append(UInt8(crc & 0xff))
    frame.append(0x03)
    return frame
  }

  static func encode(_ payload: [UInt8]) -> [UInt8] {
    buildPacket(payload)
  }

  static func parsePacket(_ frame: [UInt8]) -> [UInt8]? {
    guard let packet = VescPacketReassembler().feed(frame).first else {
      return nil
    }
    return packet
  }

  static func crc16(_ data: [UInt8]) -> UInt16 {
    var crc = 0
    for byte in data {
      crc ^= Int(byte) << 8
      for _ in 0..<8 {
        if (crc & 0x8000) != 0 {
          crc = ((crc << 1) ^ 0x1021) & 0xffff
        } else {
          crc = (crc << 1) & 0xffff
        }
      }
    }
    return UInt16(crc & 0xffff)
  }
}

internal final class VescPacketReassembler {
  private var buffer: [UInt8] = []

  func reset() {
    buffer.removeAll()
  }

  func feed(_ chunk: [UInt8]) -> [[UInt8]] {
    buffer.append(contentsOf: chunk)
    var packets: [[UInt8]] = []

    while !buffer.isEmpty {
      let start = buffer[0]
      if start != 0x02 && start != 0x03 {
        buffer.removeFirst()
        continue
      }

      let headerLength = start == 0x02 ? 2 : 3
      guard buffer.count >= headerLength else { break }

      let length: Int
      if start == 0x02 {
        length = Int(buffer[1])
      } else {
        length = (Int(buffer[1]) << 8) | Int(buffer[2])
      }

      let total = headerLength + length + 3
      guard buffer.count >= total else { break }

      guard buffer[total - 1] == 0x03 else {
        buffer.removeFirst()
        continue
      }

      let payload = Array(buffer[headerLength..<(headerLength + length)])
      let actualCrc = (UInt16(buffer[headerLength + length]) << 8) | UInt16(buffer[headerLength + length + 1])
      if VescPacketCodec.crc16(payload) == actualCrc {
        packets.append(payload)
        buffer.removeFirst(total)
      } else {
        buffer.removeFirst()
      }
    }

    return packets
  }
}

// MARK: - Refloat telemetry decode

/// One decoded Refloat `GET_ALLDATA` telemetry frame. Mirrors Android `RefloatTelemetry`.
internal struct RefloatTelemetry {
  let hasFault: Bool
  let faultCode: Int
  let pitch: Double
  let roll: Double
  let balancePitch: Double
  let balanceCurrent: Double
  let speed: Double
  let batteryVoltage: Double
  let motorCurrent: Double
  let batteryCurrent: Double
  let erpm: Int
  let dutyCycle: Double
  let state: Int
  let switchState: Int
  let adc1: Double
  let adc2: Double
  let odometer: Double?
  let tempMosfet: Double?
  let tempMotor: Double?
  let avgLatency: Int?
  let pullRateHz: Double?
  let lastPacketAt: Int64

  /// Bridge shape matching the TS `TelemetryEvent`. `location` is omitted here (added by
  /// higher layers when GPS lands); the hot-path live tick never carries it.
  func toMap() -> [String: Any?] {
    [
      "pitch": pitch,
      "roll": roll,
      "balancePitch": balancePitch,
      "balanceCurrent": balanceCurrent,
      "speed": speed,
      "batteryVoltage": batteryVoltage,
      "motorCurrent": motorCurrent,
      "batteryCurrent": batteryCurrent,
      "erpm": erpm,
      "dutyCycle": dutyCycle,
      "state": state,
      "stateName": stateName(state),
      "switchState": switchState,
      "adc1": adc1,
      "adc2": adc2,
      "odometer": odometer,
      "tempMosfet": tempMosfet,
      "tempMotor": tempMotor,
      "avgLatency": avgLatency,
      "pullRateHz": pullRateHz,
      "lastPacketAt": lastPacketAt,
    ]
  }
}

/// Decode a Refloat `COMM_CUSTOM_APP_DATA` / `GET_ALLDATA` telemetry reply. Returns `nil` for
/// unrelated payloads or truncated frames. Mirrors Android `parseRefloatGetAllData`.
internal func parseRefloatGetAllData(
  payload: [UInt8],
  avgLatency: Int?,
  packetAt: Int64,
  pullRateHz: Double?
) -> RefloatTelemetry? {
  if payload.count < 5 { return nil }
  if Int(payload[0]) != COMM_CUSTOM_APP_DATA { return nil }
  if Int(payload[1]) != REFLOAT_MAGIC { return nil }
  if Int(payload[2]) != REFLOAT_GET_ALLDATA { return nil }

  let mode = Int(payload[3])
  if mode == REFLOAT_FAULT_MODE {
    return RefloatTelemetry(
      hasFault: true,
      faultCode: payload.count > 4 ? Int(payload[4]) : 0,
      pitch: 0.0,
      roll: 0.0,
      balancePitch: 0.0,
      balanceCurrent: 0.0,
      speed: 0.0,
      batteryVoltage: 0.0,
      motorCurrent: 0.0,
      batteryCurrent: 0.0,
      erpm: 0,
      dutyCycle: 0.0,
      state: 0,
      switchState: 0,
      adc1: 0.0,
      adc2: 0.0,
      odometer: nil,
      tempMosfet: nil,
      tempMotor: nil,
      avgLatency: avgLatency,
      pullRateHz: pullRateHz,
      lastPacketAt: packetAt
    )
  }
  if payload.count < 34 { return nil }

  let hasExtended = mode >= 2 && payload.count >= 42
  let dutyRaw = Int(payload[33]) - 128
  let dutyCycle = abs(dutyRaw) <= 1 ? 0.0 : Double(dutyRaw) / 100.0
  return RefloatTelemetry(
    hasFault: false,
    faultCode: 0,
    pitch: Double(int16(payload, 20)) / 10.0,
    roll: Double(int16(payload, 8)) / 10.0,
    balancePitch: Double(int16(payload, 6)) / 10.0,
    balanceCurrent: Double(int16(payload, 4)) / 10.0,
    speed: (Double(int16(payload, 27)) / 10.0) * 3.6,
    batteryVoltage: Double(int16(payload, 23)) / 10.0,
    motorCurrent: Double(int16(payload, 29)) / 10.0,
    batteryCurrent: Double(int16(payload, 31)) / 10.0,
    erpm: int16(payload, 25),
    dutyCycle: dutyCycle,
    state: Int(payload[10]),
    switchState: Int(payload[11]),
    adc1: Double(payload[12]) / 50.0,
    adc2: Double(payload[13]) / 50.0,
    odometer: hasExtended ? float32Auto(payload, 35) : nil,
    tempMosfet: hasExtended ? Double(payload[39]) / 2.0 : nil,
    tempMotor: hasExtended ? Double(payload[40]) / 2.0 : nil,
    avgLatency: avgLatency,
    pullRateHz: pullRateHz,
    lastPacketAt: packetAt
  )
}

/// One decoded smart-BMS `COMM_BMS_GET_VALUES` snapshot. Mirrors Android `BmsTelemetry`.
internal struct BmsTelemetry {
  let capturedAt: Int64
  let voltageTotal: Double
  let vCharge: Double
  let current: Double
  let currentIc: Double
  let ampHours: Double
  let wattHours: Double
  let soc: Double?
  let soh: Double?
  let cellVoltages: [Double]
  let balancing: [Bool]
  let temps: [Double]
  let tempIc: Double?
  let tempHum: Double?
  let humidity: Double?
  let tempMaxCell: Double?
  let canId: Int?

  /// Bridge shape matching the TS `BmsEvent`. Mirrors Android `BmsTelemetry.toMap`.
  func toMap() -> [String: Any?] {
    [
      "capturedAt": capturedAt,
      "voltageTotal": voltageTotal,
      "vCharge": vCharge,
      "current": current,
      "currentIc": currentIc,
      "ampHours": ampHours,
      "wattHours": wattHours,
      "soc": soc,
      "soh": soh,
      "cellVoltages": cellVoltages,
      "balancing": balancing,
      "temps": temps,
      "tempIc": tempIc,
      "tempHum": tempHum,
      "hum": humidity,
      "tempMaxCell": tempMaxCell,
      "canId": canId,
    ]
  }
}

/// Decode a `COMM_BMS_GET_VALUES` reply from a VESC-attached smart BMS.
///
/// The VESC firmware packs scaled big-endian integers (not IEEE floats): float32 fields are
/// `int32 / scale`, float16 fields are `int16 / scale`. Layout mirrors `commands.c`:
///   v_tot, v_charge, i_in, i_in_ic (float32 1e6) · ah_cnt, wh_cnt (float32 1e3) ·
///   cell_num (u8) · v_cell[cell_num] (float16 1e3) · bal_state[cell_num] (u8) ·
///   temp_adc_num (u8) · temps_adc[] (float16 1e2) · temp_ic/temp_hum/hum/temp_max_cell (float16 1e2) ·
///   soc (u8 ×255) · soh (u8 ×255) · can_id (u8) ...
///
/// Only the stable prefix (voltages + balancing) is required; soc is best-effort so firmware
/// variants with different trailing fields still yield cell data. A non-nil result also proves a
/// real BMS answered — the Board Probe uses that as the `hasBms` capability signal.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescProtocol.kt (parseBmsValues)
internal func parseBmsValues(_ payload: [UInt8], packetAt: Int64) -> BmsTelemetry? {
  guard !payload.isEmpty else { return nil }
  guard Int(payload[0]) == COMM_BMS_GET_VALUES else { return nil }
  guard payload.count >= 26 else { return nil }

  var ind = 1
  let voltageTotal = Double(int32(payload, ind)) / 1e6; ind += 4
  let vCharge = Double(int32(payload, ind)) / 1e6; ind += 4
  let current = Double(int32(payload, ind)) / 1e6; ind += 4
  let currentIc = Double(int32(payload, ind)) / 1e6; ind += 4
  let ampHours = Double(int32(payload, ind)) / 1e3; ind += 4
  let wattHours = Double(int32(payload, ind)) / 1e3; ind += 4

  let cellNum = Int(payload[ind]); ind += 1
  guard cellNum > 0, cellNum <= 60 else { return nil }
  guard payload.count >= ind + cellNum * 2 else { return nil }

  var cellVoltages = [Double](repeating: 0, count: cellNum)
  for i in 0..<cellNum {
    cellVoltages[i] = Double(int16(payload, ind)) / 1e3
    ind += 2
  }

  var balancing = [Bool](repeating: false, count: cellNum)
  if payload.count >= ind + cellNum {
    for i in 0..<cellNum {
      balancing[i] = payload[ind] != 0
      ind += 1
    }
  }

  // Everything past balancing is firmware-variant dependent, so each trailing field is
  // read best-effort behind a bounds check and stays nil/empty when the variant omits it.
  var temps: [Double] = []
  var tempIc: Double?
  var tempHum: Double?
  var humidity: Double?
  var tempMaxCell: Double?
  var soc: Double?
  var soh: Double?
  var canId: Int?

  if payload.count > ind {
    let tempAdcNum = Int(payload[ind]); ind += 1
    if tempAdcNum >= 0, tempAdcNum <= 30, payload.count >= ind + tempAdcNum * 2 {
      for _ in 0..<tempAdcNum {
        temps.append(Double(int16(payload, ind)) / 1e2)
        ind += 2
      }
      if payload.count >= ind + 8 {
        tempIc = Double(int16(payload, ind)) / 1e2; ind += 2
        tempHum = Double(int16(payload, ind)) / 1e2; ind += 2
        humidity = Double(int16(payload, ind)) / 1e2; ind += 2
        tempMaxCell = Double(int16(payload, ind)) / 1e2; ind += 2
      }
      if payload.count > ind { soc = Double(payload[ind]) / 255.0; ind += 1 }
      if payload.count > ind { soh = Double(payload[ind]) / 255.0; ind += 1 }
      if payload.count > ind { canId = Int(payload[ind]); ind += 1 }
    }
  }

  return BmsTelemetry(
    capturedAt: packetAt,
    voltageTotal: voltageTotal,
    vCharge: vCharge,
    current: current,
    currentIc: currentIc,
    ampHours: ampHours,
    wattHours: wattHours,
    soc: soc,
    soh: soh,
    cellVoltages: cellVoltages,
    balancing: balancing,
    temps: temps,
    tempIc: tempIc,
    tempHum: tempHum,
    humidity: humidity,
    tempMaxCell: tempMaxCell,
    canId: canId
  )
}

/// Refloat/Float package board state → wire label. Mirrors Android `stateName`.
internal func stateName(_ state: Int) -> String {
  switch state & 0x0f {
  case 0: return "STARTUP"
  case 1: return "RUNNING"
  case 2: return "TILTBACK"
  case 3: return "WHEELSLIP"
  case 4: return "UPSIDEDOWN"
  case 5: return "FLYWHEEL"
  case 6: return "FAULT_PITCH"
  case 7: return "FAULT_ROLL"
  case 8: return "FAULT_SW_HALF"
  case 9: return "FAULT_SW_FULL"
  case 11: return "FAULT_STARTUP"
  case 12: return "FAULT_REVERSE"
  case 13: return "FAULT_QUICKSTOP"
  case 14: return "CHARGING"
  case 15: return "DISABLED"
  default: return "UNKNOWN"
  }
}

private func int16(_ bytes: [UInt8], _ offset: Int) -> Int {
  let raw = (Int(bytes[offset]) << 8) | Int(bytes[offset + 1])
  return raw >= 0x8000 ? raw - 0x10000 : raw
}

private func int32(_ bytes: [UInt8], _ offset: Int) -> Int {
  let raw = (UInt32(bytes[offset]) << 24) | (UInt32(bytes[offset + 1]) << 16)
    | (UInt32(bytes[offset + 2]) << 8) | UInt32(bytes[offset + 3])
  return Int(Int32(bitPattern: raw))
}

private func float32Auto(_ bytes: [UInt8], _ offset: Int) -> Double {
  let raw = (UInt32(bytes[offset]) << 24) | (UInt32(bytes[offset + 1]) << 16)
    | (UInt32(bytes[offset + 2]) << 8) | UInt32(bytes[offset + 3])
  let eRaw = Int((raw >> 23) & 0xff)
  let sigI = Int(raw & 0x7fffff)
  let negative = (raw >> 31) != 0
  if eRaw == 0 && sigI == 0 { return 0.0 }
  let significand = Double(sigI) / (8388608.0 * 2.0) + 0.5
  let result = significand * pow(2.0, Double(eRaw - 126))
  return negative ? -result : result
}
