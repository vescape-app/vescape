import Foundation

/// Why Vescape asked the controller for its retained fault register.
///
/// The reason is durable evidence metadata, not scheduling state: it says what the read was for, so
/// a baseline can never be mistaken for a discovery and an idle sweep can never be mistaken for the
/// immediate answer to a live fault.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultRegister.kt `VescFaultRegisterReason`
/// @parity /modules/vescape-core/src/index.ts `VescFaultRegisterReason`
enum VescFaultRegisterReason: String {
  /// First read after a link/re-link, or a Board saved before the feature existed.
  case baseline
  /// A Board Session became ready.
  case connect
  /// Immediately after a live Refloat fault trigger.
  case live
  /// The Board has been standing still long enough that a terminal read is safe.
  case stationary
  /// Best effort while an intentional disconnect is being torn down.
  case predisconnect
  /// Infrequent fallback so a long quiet session still audits the register.
  case idle
}

/// How a terminal read ended. `COMM_PRINT` has no completion frame, so this is the only honest
/// statement Vescape can make about the bytes it holds.
///
/// An `incomplete` read is still evidence — the partial bytes are kept — but it never proves an
/// empty register and never produces an occurrence.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultRegister.kt `VescFaultRegisterStatus`
/// @parity /modules/vescape-core/src/index.ts `VescFaultRegisterStatus`
enum VescFaultRegisterStatus: String {
  /// Output settled: the controller went quiet for a full idle boundary after answering.
  case complete
  /// The hard bound elapsed while output was still arriving, or nothing arrived at all.
  case incomplete
}

/// One labelled line of a fault block, kept in print order.
struct VescFaultRegisterField: Codable {
  let label: String
  let value: String
}

/// One parsed fault block out of the controller's register.
///
/// A **projection** of `VescFaultRegisterSnapshot.raw`, never a replacement for it: `fields` keeps
/// every `Label : value` line the firmware printed, including ones Vescape has no meaning for, and
/// `rawBlock` keeps the block verbatim. `code` is nil when the firmware named a fault this build
/// does not know.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultRegister.kt `VescFaultRegisterEntry`
/// @parity /modules/vescape-core/src/index.ts `VescFaultRegisterEntry`
struct VescFaultRegisterEntry: Codable {
  /// Controller order, oldest printed block first. Preserved so register-only faults keep it.
  let position: Int
  /// VESC `mc_fault_code` resolved from `name`, or nil for a name this build does not know.
  let code: Int?
  /// The firmware's own fault name, e.g. `FAULT_CODE_ABS_OVER_CURRENT`. Always kept verbatim.
  let name: String
  /// Every labelled line of the block, in print order. Unknown labels survive here.
  let fields: [VescFaultRegisterField]
  /// The block exactly as printed, so a parser change can never lose the original.
  let rawBlock: String

  func toMap() -> [String: Any?] {
    [
      "position": position,
      "code": code,
      "name": name,
      "fields": fields.map { ["label": $0.label, "value": $0.value] },
      "rawBlock": rawBlock,
    ]
  }
}

/// One retained read of the controller's fault register.
///
/// `raw` is the authority. `text` and `entries` are conveniences derived from it, and `entries` is
/// nil whenever the parser could not make sense of the output — a parser that fails must never cost
/// Vescape the bytes the controller actually sent.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultRegister.kt `VescFaultRegisterSnapshot`
/// @parity /modules/vescape-core/src/index.ts `VescFaultRegisterSnapshot`
struct VescFaultRegisterSnapshot {
  let id: String
  let boardId: String
  let readAtMs: Int64
  let reason: VescFaultRegisterReason
  let status: VescFaultRegisterStatus
  /// Exact `COMM_PRINT` payload bytes, concatenated in arrival order.
  let raw: Data
  /// Lossy display projection of `raw`.
  let text: String
  /// Parsed blocks, or nil when the output could not be parsed. Empty = register proven empty.
  let entries: [VescFaultRegisterEntry]?

  func toMap() -> [String: Any?] {
    [
      "id": id,
      "boardId": boardId,
      "readAtMs": readAtMs,
      "reason": reason.rawValue,
      "status": status.rawValue,
      "byteCount": raw.count,
      "text": text,
      "entries": entries?.map { $0.toMap() },
    ]
  }
}

/// Turns VESC's `faults` terminal output into fault blocks.
///
/// Deliberately forgiving: firmware output varies by version and build, so any labelled line is kept
/// even when Vescape has no meaning for it, and an unrecognised shape returns nil rather than an
/// empty register. Only `parse` returning an empty array means "the controller has no faults".
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultRegister.kt `VescFaultRegisterParser`
enum VescFaultRegisterParser {
  /// The label that opens a fault block in VESC's `terminal.c` fault dump.
  private static let faultLabel = "Fault"

  /// Parse complete terminal output.
  ///
  /// - Returns: the blocks in controller order, an empty array when the controller stated it has no
  ///   faults, or nil when the output matched neither shape (kept as raw evidence only).
  static func parse(_ text: String) -> [VescFaultRegisterEntry]? {
    let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    var blocks: [[VescFaultRegisterField]] = []
    var blockLines: [[String]] = []
    for line in normalized.split(separator: "\n", omittingEmptySubsequences: false) {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      if trimmed.isEmpty { continue }
      let labelled = labelOf(trimmed)
      if let labelled, labelled.label.caseInsensitiveCompare(Self.faultLabel) == .orderedSame {
        blocks.append([labelled])
        blockLines.append([trimmed])
        continue
      }
      if blocks.isEmpty { continue }
      blockLines[blockLines.count - 1].append(trimmed)
      // Unlabelled continuation lines still belong to the block: keep them under an empty label so
      // the projection never silently drops firmware output.
      blocks[blocks.count - 1].append(labelled ?? VescFaultRegisterField(label: "", value: trimmed))
    }
    if blocks.isEmpty {
      // VESC prints "No faults registered since startup" for an empty register. Only that explicit
      // statement proves emptiness — anything else is unparsed evidence.
      return normalized.range(of: "no faults", options: .caseInsensitive) != nil ? [] : nil
    }
    return blocks.enumerated().map { index, fields in
      let name = fields[0].value
      return VescFaultRegisterEntry(
        position: index,
        code: faultCode(forName: name),
        name: name,
        fields: fields,
        rawBlock: blockLines[index].joined(separator: "\n")
      )
    }
  }

  /// Splits `Label : value`. Returns nil for a line without a separator.
  private static func labelOf(_ line: String) -> VescFaultRegisterField? {
    guard let separator = line.firstIndex(of: ":"), separator != line.startIndex else { return nil }
    return VescFaultRegisterField(
      label: String(line[line.startIndex..<separator]).trimmingCharacters(in: .whitespaces),
      value: String(line[line.index(after: separator)...]).trimmingCharacters(in: .whitespaces)
    )
  }

  /// VESC `mc_fault_code` values, keyed by the firmware's own printed name.
  ///
  /// This is a **different code space** from the Refloat fault codes carried by live `ALLDATA`
  /// frames: the controller register holds motor-controller faults, Refloat reports its own balance
  /// faults. Nothing here may be compared numerically with a live occurrence's code.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultRegister.kt `CODES_BY_NAME`
  /// @parity /modules/vescape-core/src/modules/board/lib/vescFaults.ts `VESC_FAULT_TITLES`
  private static let codesByName: [String: Int] = [
    "NONE": 0,
    "OVER_VOLTAGE": 1,
    "UNDER_VOLTAGE": 2,
    "DRV": 3,
    "ABS_OVER_CURRENT": 4,
    "OVER_TEMP_FET": 5,
    "OVER_TEMP_MOTOR": 6,
    "GATE_DRIVER_OVER_VOLTAGE": 7,
    "GATE_DRIVER_UNDER_VOLTAGE": 8,
    "MCU_UNDER_VOLTAGE": 9,
    "BOOTING_FROM_WATCHDOG_RESET": 10,
    "ENCODER_SPI": 11,
    "ENCODER_SINCOS_BELOW_MIN_AMPLITUDE": 12,
    "ENCODER_SINCOS_ABOVE_MAX_AMPLITUDE": 13,
    "FLASH_CORRUPTION": 14,
    "HIGH_OFFSET_CURRENT_SENSOR_1": 15,
    "HIGH_OFFSET_CURRENT_SENSOR_2": 16,
    "HIGH_OFFSET_CURRENT_SENSOR_3": 17,
    "UNBALANCED_CURRENTS": 18,
    "BRK": 19,
    "RESOLVER_LOT": 20,
    "RESOLVER_DOS": 21,
    "RESOLVER_LOS": 22,
    "FLASH_CORRUPTION_APP_CFG": 23,
    "FLASH_CORRUPTION_MC_CFG": 24,
    "ENCODER_NO_MAGNET": 25,
    "ENCODER_MAGNET_TOO_STRONG": 26,
    "PHASE_FILTER": 27,
    "ENCODER_FAULT": 28,
    "LV_OUTPUT_FAULT": 29,
  ]

  /// Resolves a printed fault name to its `mc_fault_code`, or nil for a name this build lacks.
  static func faultCode(forName name: String) -> Int? {
    var key = name.trimmingCharacters(in: .whitespaces).uppercased()
    if key.hasPrefix("FAULT_CODE_") { key = String(key.dropFirst("FAULT_CODE_".count)) }
    return codesByName[key]
  }
}

/// Serialize parsed entries for the snapshot row. Nil (unparsed) round-trips as nil.
func encodeRegisterEntries(_ entries: [VescFaultRegisterEntry]?) -> String? {
  guard let entries, let data = try? JSONEncoder().encode(entries) else { return nil }
  return String(data: data, encoding: .utf8)
}

/// Inverse of `encodeRegisterEntries`. Malformed JSON decodes to nil (treated as unparsed).
func decodeRegisterEntries(_ json: String?) -> [VescFaultRegisterEntry]? {
  guard let json, let data = json.data(using: .utf8) else { return nil }
  return try? JSONDecoder().decode([VescFaultRegisterEntry].self, from: data)
}
