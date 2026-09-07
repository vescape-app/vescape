import Compression
import CryptoKit
import Foundation

/// Refloat config XML schema: the wire config blob is a flat byte array whose layout is described by
/// a `COMM_GET_CUSTOM_CONFIG_XML` schema. Two dialects are supported — a flat `<param .../>` list and
/// VESC's serialized `<ConfigParams>` struct — matching Android field-for-field so both platforms
/// decode identical snapshots (#171).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigSchema.kt

enum RefloatConfigValueType {
  case float32
  case float32Scaled
  case float32Auto
  case float16Scaled
  case int32
  case uint32
  case int16
  case uint16
  case int8
  case uint8
  case bool

  var byteSize: Int {
    switch self {
    case .float32, .float32Scaled, .float32Auto, .int32, .uint32: return 4
    case .float16Scaled, .int16, .uint16: return 2
    case .int8, .uint8, .bool: return 1
    }
  }
}

struct RefloatConfigSchemaField {
  let id: String
  let type: RefloatConfigValueType
  let label: String
  let unit: String?
  let min: Double?
  let max: Double?
  let offset: Int
  let scale: Double?

  init(
    id: String,
    type: RefloatConfigValueType,
    label: String,
    unit: String?,
    min: Double?,
    max: Double?,
    offset: Int,
    scale: Double? = nil
  ) {
    self.id = id
    self.type = type
    self.label = label
    self.unit = unit
    self.min = min
    self.max = max
    self.offset = offset
    self.scale = scale
  }
}

struct RefloatConfigSchema {
  let hash: String
  let fields: [RefloatConfigSchemaField]
}

struct RefloatConfigSchemaException: Error {
  let message: String
  init(_ message: String) { self.message = message }
}

enum RefloatConfigSchemaParser {
  static func parse(_ xmlBytes: [UInt8]) throws -> RefloatConfigSchema {
    let normalizedXmlBytes = normalizeXmlBytes(xmlBytes)
    if containsDocumentType(String(decoding: normalizedXmlBytes, as: UTF8.self)) {
      throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: document type declarations are forbidden")
    }
    let root: RefloatXmlNode
    do {
      root = try RefloatXmlNode.parse(Data(normalizedXmlBytes))
    } catch {
      let preview = xmlBytes.prefix(96).map { String(format: "%02x", $0) }.joined(separator: " ")
      let normalizedPreview = normalizedXmlBytes.prefix(96)
        .map { String(format: "%02x", $0) }.joined(separator: " ")
      throw RefloatConfigSchemaException(
        "UNSUPPORTED_SCHEMA: invalid XML (\((error as? RefloatXmlError)?.message ?? "parse error")); "
          + "rawPrefix=\(preview); normalizedPrefix=\(normalizedPreview)"
      )
    }

    if root.name == "ConfigParams" {
      return try parseVescConfigParams(root, normalizedXmlBytes)
    }

    let nodes = root.descendants(named: "param")
    if nodes.isEmpty { throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: no param nodes") }

    var offset = 0
    var fields: [RefloatConfigSchemaField] = []
    for node in nodes {
      let id = node.attribute("name") ?? node.attribute("id")
      guard let id, !id.isEmpty else {
        throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: param missing name")
      }
      let type = try parseType(node.attribute("type") ?? "float")
      fields.append(
        RefloatConfigSchemaField(
          id: id,
          type: type,
          label: node.attribute("label") ?? id,
          unit: node.attribute("unit")?.nilIfBlank,
          min: node.attribute("min").flatMap { Double($0) },
          max: node.attribute("max").flatMap { Double($0) },
          offset: offset
        )
      )
      offset += type.byteSize
    }
    return RefloatConfigSchema(hash: sha256(normalizedXmlBytes), fields: fields)
  }

  static func containsDocumentType(_ xml: String) -> Bool {
    let lower = xml.lowercased()
    var cursor = lower.startIndex
    while let marker = lower[cursor...].range(of: "<!")?.lowerBound {
      if lower[marker...].hasPrefix("<!--") {
        guard let end = lower[marker...].range(of: "-->")?.upperBound else { return false }
        cursor = end
      } else if lower[marker...].hasPrefix("<![cdata[") {
        guard let end = lower[marker...].range(of: "]]>")?.upperBound else { return false }
        cursor = end
      } else if lower[marker...].hasPrefix("<!doctype") {
        return true
      } else {
        cursor = lower.index(marker, offsetBy: 2)
      }
    }
    return false
  }

  static func normalizeXmlBytes(_ bytes: [UInt8]) -> [UInt8] {
    if let zlibStart = findZlibStart(bytes),
      let inflated = inflateRawDeflate(Array(bytes[(zlibStart + 2)...])) {
      return inflated
    }

    if let textStart = bytes.firstIndex(of: UInt8(ascii: "<")) {
      return Array(bytes[textStart...])
    }

    return bytes
  }

  private static func findZlibStart(_ bytes: [UInt8]) -> Int? {
    guard bytes.count >= 2 else { return nil }
    for i in 0..<(bytes.count - 1) {
      let b0 = bytes[i]
      let b1 = bytes[i + 1]
      if b0 == 0x78, [0x01, 0x5e, 0x9c, 0xda].contains(b1) { return i }
    }
    return nil
  }

  /// Raw DEFLATE (RFC 1951) inflate with an unknown output size. The 2-byte zlib header is stripped by
  /// the caller; Apple's `COMPRESSION_ZLIB` decodes the raw stream and ignores the adler32 trailer.
  private static func inflateRawDeflate(_ deflate: [UInt8]) -> [UInt8]? {
    guard !deflate.isEmpty else { return nil }
    var stream = compression_stream(
      dst_ptr: UnsafeMutablePointer<UInt8>.allocate(capacity: 0),
      dst_size: 0,
      src_ptr: UnsafePointer<UInt8>(bitPattern: 1)!,
      src_size: 0,
      state: nil
    )
    guard compression_stream_init(&stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB)
      == COMPRESSION_STATUS_OK else { return nil }
    defer { compression_stream_destroy(&stream) }

    let bufferSize = 32_768
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
    defer { buffer.deallocate() }

    var output: [UInt8] = []
    return deflate.withUnsafeBufferPointer { src -> [UInt8]? in
      stream.src_ptr = src.baseAddress!
      stream.src_size = src.count
      while true {
        stream.dst_ptr = buffer
        stream.dst_size = bufferSize
        let status = compression_stream_process(&stream, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
        let produced = bufferSize - stream.dst_size
        if produced > 0 { output.append(contentsOf: UnsafeBufferPointer(start: buffer, count: produced)) }
        switch status {
        case COMPRESSION_STATUS_OK:
          continue
        case COMPRESSION_STATUS_END:
          return output.isEmpty ? nil : output
        default:
          return nil
        }
      }
    }
  }

  private static func parseVescConfigParams(
    _ root: RefloatXmlNode,
    _ xmlBytes: [UInt8]
  ) throws -> RefloatConfigSchema {
    guard let paramsNode = root.descendants(named: "Params").first else {
      throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: ConfigParams missing Params")
    }
    var params: [String: RefloatXmlNode] = [:]
    for child in paramsNode.children { params[child.name] = child }

    guard let orderNode = root.descendants(named: "SerOrder").first else {
      throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: ConfigParams missing SerOrder")
    }
    let order = orderNode.children
      .filter { $0.name == "ser" }
      .map { $0.textContent.trimmingCharacters(in: .whitespacesAndNewlines) }
    if order.isEmpty { throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: empty SerOrder") }

    var offset = 0
    var fields: [RefloatConfigSchemaField] = []
    for name in order {
      guard let node = params[name] else {
        throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: serialized param missing \(name)")
      }
      guard let type = text(node, "type").flatMap({ Int($0) }) else {
        throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: param \(name) missing type")
      }
      let vTx = text(node, "vTx").flatMap { Int($0) } ?? 0
      let valueType = try parseVescValueType(type: type, vTx: vTx, name: name)
      fields.append(
        RefloatConfigSchemaField(
          id: name,
          type: valueType,
          label: text(node, "longName") ?? name,
          unit: text(node, "suffix")?.nilIfBlank,
          min: text(node, "minDouble").flatMap { Double($0) }
            ?? text(node, "minInt").flatMap { Double($0) },
          max: text(node, "maxDouble").flatMap { Double($0) }
            ?? text(node, "maxInt").flatMap { Double($0) },
          offset: offset,
          scale: text(node, "vTxDoubleScale").flatMap { Double($0) }
        )
      )
      offset += valueType.byteSize
    }
    return RefloatConfigSchema(hash: sha256(xmlBytes), fields: fields)
  }

  private static func text(_ parent: RefloatXmlNode, _ tag: String) -> String? {
    guard let node = parent.descendants(named: tag).first else { return nil }
    return node.textContent.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func parseVescValueType(type: Int, vTx: Int, name: String) throws -> RefloatConfigValueType {
    switch type {
    case 1:
      switch vTx {
      case 7: return .float16Scaled
      case 8: return .float32Scaled
      case 9: return .float32Auto
      default: throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: double \(name) has tx \(vTx)")
      }
    case 2:
      switch vTx {
      case 1: return .uint8
      case 2: return .int8
      case 3: return .uint16
      case 4: return .int16
      case 5: return .uint32
      case 6: return .int32
      default: throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: int \(name) has tx \(vTx)")
      }
    case 4, 5, 6:
      return .int8
    default:
      throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: unsupported ConfigParams type \(type) for \(name)")
    }
  }

  private static func parseType(_ raw: String) throws -> RefloatConfigValueType {
    switch raw.lowercased() {
    case "float", "float32", "f32": return .float32
    case "int", "int32", "i32": return .int32
    case "uint", "uint32", "u32": return .uint32
    case "int16", "i16": return .int16
    case "uint16", "u16": return .uint16
    case "int8", "i8": return .int8
    case "uint8", "u8": return .uint8
    case "bool", "boolean": return .bool
    default: throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: unknown type \(raw)")
    }
  }

  private static func sha256(_ bytes: [UInt8]) -> String {
    SHA256.hash(data: Data(bytes)).map { String(format: "%02x", $0) }.joined()
  }
}

private extension String {
  var nilIfBlank: String? { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self }
}
