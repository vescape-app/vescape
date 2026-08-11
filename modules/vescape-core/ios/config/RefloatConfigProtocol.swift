import Foundation

struct RefloatConfigXmlChunk {
  let confInd: Int
  let totalLength: Int
  let offset: Int
  let chunk: [UInt8]
}

struct RefloatConfigBytes {
  let confInd: Int
  let packageSignature: UInt32
  let config: [UInt8]
}

struct RefloatPackageInfo {
  let version: String
}

enum RefloatConfigProtocolResult<T> {
  case success(T)
  case failure(String)
}

/// COMM_GET_CUSTOM_CONFIG_XML / COMM_GET_CUSTOM_CONFIG / COMM_SET_CUSTOM_CONFIG framing, parity with Android.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigProtocol.kt
enum RefloatConfigProtocol {
  static func normalizeBaseVersion(_ version: String?) -> String? {
    guard let version = version?.trimmingCharacters(in: .whitespacesAndNewlines), !version.isEmpty else {
      return nil
    }
    guard let match = version.range(of: #"\b\d+\.\d+(?:\.\d+)?\b"#, options: .regularExpression) else {
      return nil
    }
    return String(version[match])
  }

  static func buildGetInfo(transport: BoardTransport, version: Int = 1) -> [UInt8] {
    precondition((0...255).contains(version), "version must fit uint8")
    return transport.frame([
      UInt8(COMM_CUSTOM_APP_DATA),
      UInt8(REFLOAT_MAGIC),
      UInt8(REFLOAT_GET_INFO),
      UInt8(version),
    ])
  }

  static func buildGetCustomConfigXml(
    transport: BoardTransport,
    confInd: Int,
    length: Int,
    offset: Int
  ) -> [UInt8] {
    precondition((0...255).contains(confInd), "confInd must fit uint8")
    precondition(length >= 0, "length must be non-negative")
    precondition(offset >= 0, "offset must be non-negative")
    return transport.frame([
      UInt8(COMM_GET_CUSTOM_CONFIG_XML),
      UInt8(confInd),
    ] + int32Bytes(length) + int32Bytes(offset))
  }

  static func buildGetCustomConfig(transport: BoardTransport, confInd: Int) -> [UInt8] {
    precondition((0...255).contains(confInd), "confInd must fit uint8")
    return transport.frame([UInt8(COMM_GET_CUSTOM_CONFIG), UInt8(confInd)])
  }

  static func buildSetCustomConfig(
    transport: BoardTransport,
    confInd: Int,
    packageSignature: UInt32,
    configBytes: [UInt8]
  ) -> [UInt8] {
    precondition((0...255).contains(confInd), "confInd must fit uint8")
    var frame: [UInt8] = [UInt8(COMM_SET_CUSTOM_CONFIG), UInt8(confInd)]
    frame.append(UInt8((packageSignature >> 24) & 0xff))
    frame.append(UInt8((packageSignature >> 16) & 0xff))
    frame.append(UInt8((packageSignature >> 8) & 0xff))
    frame.append(UInt8(packageSignature & 0xff))
    frame.append(contentsOf: configBytes)
    return transport.frame(frame)
  }

  static func parseSetCustomConfigResponse(
    _ payload: [UInt8],
    expectedConfInd: Int = 0
  ) -> RefloatConfigProtocolResult<Int> {
    let offset: Int
    switch commandOffset(payload, expectedCommand: COMM_SET_CUSTOM_CONFIG) {
    case .success(let value): offset = value
    case .failure(let message): return .failure(message)
    }
    if payload.count == offset + 1 {
      return .success(expectedConfInd)
    }
    let confInd = Int(payload[offset + 1])
    if confInd != expectedConfInd {
      return .failure("Unexpected Refloat set config index \(confInd)")
    }
    return .success(confInd)
  }

  static func parseCustomConfigXmlResponse(
    _ payload: [UInt8],
    expectedConfInd: Int = 0
  ) -> RefloatConfigProtocolResult<RefloatConfigXmlChunk> {
    let cmdOffset: Int
    switch commandOffset(payload, expectedCommand: COMM_GET_CUSTOM_CONFIG_XML) {
    case .success(let value): cmdOffset = value
    case .failure(let message): return .failure(message)
    }
    if payload.count < cmdOffset + 10 {
      return .failure("Short Refloat config XML response: \(payload.count - cmdOffset) bytes")
    }
    let confInd = Int(payload[cmdOffset + 1])
    if confInd != expectedConfInd {
      return .failure("Unexpected Refloat config XML index \(confInd)")
    }
    let totalLength = readInt32(payload, cmdOffset + 2)
    let dataOffset = readInt32(payload, cmdOffset + 6)
    if totalLength < 0 { return .failure("Negative Refloat config XML length \(totalLength)") }
    if dataOffset < 0 || dataOffset > totalLength {
      return .failure("Invalid Refloat config XML offset \(dataOffset) for length \(totalLength)")
    }
    let chunk = Array(payload[(cmdOffset + 10)..<payload.count])
    if dataOffset + chunk.count > totalLength {
      return .failure(
        "Refloat config XML chunk exceeds length: offset=\(dataOffset) chunk=\(chunk.count) length=\(totalLength)"
      )
    }
    return .success(RefloatConfigXmlChunk(confInd: confInd, totalLength: totalLength, offset: dataOffset, chunk: chunk))
  }

  static func parseCustomConfigResponse(
    _ payload: [UInt8],
    expectedConfInd: Int = 0
  ) -> RefloatConfigProtocolResult<RefloatConfigBytes> {
    let offset: Int
    switch commandOffset(payload, expectedCommand: COMM_GET_CUSTOM_CONFIG) {
    case .success(let value): offset = value
    case .failure(let message): return .failure(message)
    }
    if payload.count < offset + 6 {
      return .failure("Short Refloat config response: \(payload.count - offset) bytes")
    }
    let confInd = Int(payload[offset + 1])
    if confInd != expectedConfInd {
      return .failure("Unexpected Refloat config index \(confInd)")
    }
    return .success(
      RefloatConfigBytes(
        confInd: confInd,
        packageSignature: UInt32(bitPattern: Int32(readInt32(payload, offset + 2))),
        config: Array(payload[(offset + 6)..<payload.count])
      )
    )
  }

  static func parseGetInfoResponse(_ payload: [UInt8]) -> RefloatConfigProtocolResult<RefloatPackageInfo> {
    let offset: Int
    switch appCommandOffset(payload, expectedCommand: REFLOAT_GET_INFO) {
    case .success(let value): offset = value
    case .failure(let message): return .failure(message)
    }
    let dataOffset = offset + 1
    if payload.count <= dataOffset { return .failure("Short Refloat info response: 0 bytes") }
    if payload[dataOffset] == 2 { return parseGetInfoV2(payload, dataOffset) }
    return parseGetInfoV1(payload, dataOffset)
  }

  private static func commandOffset(
    _ payload: [UInt8],
    expectedCommand: Int
  ) -> RefloatConfigProtocolResult<Int> {
    guard !payload.isEmpty else { return .failure("Empty Refloat config response") }
    let cmd = Int(payload[0])
    if cmd == expectedCommand { return .success(0) }
    if cmd == COMM_FORWARD_CAN {
      if payload.count < 3 { return .failure("Short forwarded Refloat config response") }
      let forwarded = Int(payload[2])
      if forwarded == expectedCommand { return .success(2) }
      return .failure("Unexpected forwarded Refloat config command \(forwarded), expected \(expectedCommand)")
    }
    return .failure("Unexpected Refloat config command \(cmd), expected \(expectedCommand)")
  }

  private static func appCommandOffset(
    _ payload: [UInt8],
    expectedCommand: Int
  ) -> RefloatConfigProtocolResult<Int> {
    if payload.count < 3 { return .failure("Short Refloat app response") }
    let cmd = Int(payload[0])
    if cmd == COMM_CUSTOM_APP_DATA {
      let magic = Int(payload[1])
      let appCommand = Int(payload[2])
      if magic != REFLOAT_MAGIC { return .failure("Unexpected Refloat magic \(magic)") }
      if appCommand == expectedCommand { return .success(2) }
      return .failure("Unexpected Refloat app command \(appCommand), expected \(expectedCommand)")
    }
    if cmd == COMM_FORWARD_CAN {
      if payload.count < 5 { return .failure("Short forwarded Refloat app response") }
      let forwarded = Int(payload[2])
      let magic = Int(payload[3])
      let appCommand = Int(payload[4])
      if forwarded != COMM_CUSTOM_APP_DATA {
        return .failure("Unexpected forwarded Refloat command \(forwarded), expected \(COMM_CUSTOM_APP_DATA)")
      }
      if magic != REFLOAT_MAGIC { return .failure("Unexpected Refloat magic \(magic)") }
      if appCommand == expectedCommand { return .success(4) }
      return .failure("Unexpected forwarded Refloat app command \(appCommand), expected \(expectedCommand)")
    }
    return .failure("Unexpected Refloat app response command \(cmd), expected \(COMM_CUSTOM_APP_DATA)")
  }

  private static func parseGetInfoV1(
    _ payload: [UInt8],
    _ dataOffset: Int
  ) -> RefloatConfigProtocolResult<RefloatPackageInfo> {
    if payload.count < dataOffset + 3 {
      return .failure("Short Refloat info v1 response: \(payload.count - dataOffset) bytes")
    }
    let versionCode = Int(payload[dataOffset])
    return .success(RefloatPackageInfo(version: "Refloat \(versionCode / 10).\(versionCode % 10)"))
  }

  private static func parseGetInfoV2(
    _ payload: [UInt8],
    _ dataOffset: Int
  ) -> RefloatConfigProtocolResult<RefloatPackageInfo> {
    let minLength = dataOffset + 2 + 20 + 3
    if payload.count < minLength {
      return .failure("Short Refloat info v2 response: \(payload.count - dataOffset) bytes")
    }
    let packageName = displayName(fixedString(payload, dataOffset + 2, 20))
    let major = Int(payload[dataOffset + 22])
    let minor = Int(payload[dataOffset + 23])
    let patch = Int(payload[dataOffset + 24])
    let suffix = payload.count >= dataOffset + 45 ? fixedString(payload, dataOffset + 25, 20) : ""
    let suffixPart = suffix.isEmpty ? "" : (suffix.hasPrefix("-") ? suffix : "-\(suffix)")
    return .success(RefloatPackageInfo(version: "\(packageName) \(major).\(minor).\(patch)\(suffixPart)"))
  }

  private static func fixedString(_ payload: [UInt8], _ offset: Int, _ length: Int) -> String {
    let limit = min(offset + length, payload.count)
    var end = offset
    while end < limit && payload[end] != 0 { end += 1 }
    if end <= offset { return "" }
    return String(bytes: payload[offset..<end], encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }

  private static func displayName(_ raw: String) -> String {
    if raw.isEmpty { return "Refloat" }
    return raw.prefix(1).uppercased() + raw.dropFirst()
  }

  private static func int32Bytes(_ value: Int) -> [UInt8] {
    [
      UInt8((value >> 24) & 0xff),
      UInt8((value >> 16) & 0xff),
      UInt8((value >> 8) & 0xff),
      UInt8(value & 0xff),
    ]
  }

  private static func readInt32(_ bytes: [UInt8], _ offset: Int) -> Int {
    let value = (UInt32(bytes[offset]) << 24)
      | (UInt32(bytes[offset + 1]) << 16)
      | (UInt32(bytes[offset + 2]) << 8)
      | UInt32(bytes[offset + 3])
    return Int(Int32(bitPattern: value))
  }
}
