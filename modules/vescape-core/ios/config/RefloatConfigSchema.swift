import Compression
import CryptoKit
import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigSchema.kt
/// @parity /modules/vescape-core/src/index.ts `BoardConfigValueType`
enum RefloatConfigValueType: String, Equatable {
  case float32
  case float32Scaled = "float32_scaled"
  case float32Auto = "float32_auto"
  case float16Scaled = "float16_scaled"
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigSchema.kt `RefloatConfigSchemaErrorCode`
enum RefloatConfigSchemaErrorCode: Equatable {
  case unsupportedSchema
  case duplicateFieldId
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigSchema.kt `RefloatConfigSchemaGroupItem`
/// @parity /modules/vescape-core/src/index.ts `BoardConfigSchemaGroupItem`
enum RefloatConfigSchemaGroupItem: Equatable {
  case separator(String)
  case field(String)

  func toBridgeMap() -> [String: Any] {
    switch self {
    case let .separator(title):
      return ["kind": "separator", "title": title]
    case let .field(fieldId):
      return ["kind": "field", "fieldId": fieldId]
    }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigSchema.kt `RefloatConfigSchemaSubgroup`
/// @parity /modules/vescape-core/src/index.ts `BoardConfigSchemaSubgroup`
struct RefloatConfigSchemaSubgroup: Equatable {
  let name: String
  let items: [RefloatConfigSchemaGroupItem]

  func toBridgeMap() -> [String: Any] {
    [
      "name": name,
      "items": items.map { $0.toBridgeMap() },
    ]
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigSchema.kt `RefloatConfigSchemaGroup`
/// @parity /modules/vescape-core/src/index.ts `BoardConfigSchemaGroup`
struct RefloatConfigSchemaGroup: Equatable {
  let name: String
  let subgroups: [RefloatConfigSchemaSubgroup]

  func toBridgeMap() -> [String: Any] {
    [
      "name": name,
      "subgroups": subgroups.map { $0.toBridgeMap() },
    ]
  }
}

enum RefloatConfigDefaultValue: Equatable {
  case number(Double)
  case bool(Bool)
  case string(String)

  func toBridgeValue() -> Any {
    switch self {
    case let .number(value): return value
    case let .bool(value): return value
    case let .string(value): return value
    }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigSchema.kt `RefloatConfigSchemaField`
/// @parity /modules/vescape-core/src/index.ts `BoardConfigSchemaField`
struct RefloatConfigSchemaField: Equatable {
  let id: String
  let type: RefloatConfigValueType
  let label: String
  let unit: String?
  let min: Double?
  let max: Double?
  let offset: Int
  let scale: Double?
  let xmlType: Int?
  let vTx: Int?
  let step: Double?
  let editorDecimals: Int?
  let editorScale: Double?
  let editAsPercentage: Bool
  let enumNames: [String]
  let defaultValue: RefloatConfigDefaultValue?
  let transmittable: Bool
  let showDisplay: Bool
  let cDefine: String?
  let description: String?

  init(
    id: String,
    type: RefloatConfigValueType,
    label: String,
    unit: String?,
    min: Double?,
    max: Double?,
    offset: Int,
    scale: Double? = nil,
    xmlType: Int? = nil,
    vTx: Int? = nil,
    step: Double? = nil,
    editorDecimals: Int? = nil,
    editorScale: Double? = nil,
    editAsPercentage: Bool = false,
    enumNames: [String] = [],
    defaultValue: RefloatConfigDefaultValue? = nil,
    transmittable: Bool = true,
    showDisplay: Bool = false,
    cDefine: String? = nil,
    description: String? = nil
  ) {
    self.id = id
    self.type = type
    self.label = label
    self.unit = unit
    self.min = min
    self.max = max
    self.offset = offset
    self.scale = scale
    self.xmlType = xmlType
    self.vTx = vTx
    self.step = step
    self.editorDecimals = editorDecimals
    self.editorScale = editorScale
    self.editAsPercentage = editAsPercentage
    self.enumNames = enumNames
    self.defaultValue = defaultValue
    self.transmittable = transmittable
    self.showDisplay = showDisplay
    self.cDefine = cDefine
    self.description = description
  }

  func toBridgeMap() -> [String: Any?] {
    [
      "id": id,
      "type": type.rawValue,
      "xmlType": xmlType,
      "vTx": vTx,
      "label": label,
      "unit": unit,
      "min": min,
      "max": max,
      "offset": offset,
      "scale": scale,
      "step": step,
      "editorDecimals": editorDecimals,
      "editorScale": editorScale,
      "editAsPercentage": editAsPercentage,
      "enumNames": enumNames,
      "defaultValue": defaultValue?.toBridgeValue(),
      "transmittable": transmittable,
      "showDisplay": showDisplay,
      "cDefine": cDefine,
      "description": description,
    ]
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigSchema.kt `RefloatConfigSchema`
/// @parity /modules/vescape-core/src/index.ts `BoardConfigSchema`
struct RefloatConfigSchema: Equatable {
  let hash: String
  let fields: [RefloatConfigSchemaField]
  let groups: [RefloatConfigSchemaGroup]
  let rawXml: String

  init(
    hash: String,
    fields: [RefloatConfigSchemaField],
    groups: [RefloatConfigSchemaGroup] = [],
    rawXml: String = ""
  ) {
    self.hash = hash
    self.fields = fields
    self.groups = groups
    self.rawXml = rawXml
  }

  func toBridgeMap() -> [String: Any] {
    [
      "hash": hash,
      "fields": fields.map { $0.toBridgeMap() },
      "groups": groups.map { $0.toBridgeMap() },
    ]
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigSchema.kt `RefloatConfigSchemaException`
struct RefloatConfigSchemaException: Error, Equatable {
  let code: RefloatConfigSchemaErrorCode
  let message: String

  init(_ message: String, code: RefloatConfigSchemaErrorCode = .unsupportedSchema) {
    self.code = code
    self.message = message
  }
}

enum RefloatConfigSchemaParser {
  private static let headRegex = try! NSRegularExpression(
    pattern: "<head\\b[^>]*>.*?</head>",
    options: [.caseInsensitive, .dotMatchesLineSeparators]
  )
  private static let styleRegex = try! NSRegularExpression(
    pattern: "<style\\b[^>]*>.*?</style>",
    options: [.caseInsensitive, .dotMatchesLineSeparators]
  )
  private static let doctypeRegex = try! NSRegularExpression(
    pattern: "<!doctype[^>]*>",
    options: [.caseInsensitive, .dotMatchesLineSeparators]
  )
  private static let brRegex = try! NSRegularExpression(
    pattern: "<br\\s*/?>",
    options: [.caseInsensitive]
  )
  private static let blockEndRegex = try! NSRegularExpression(
    pattern: "</(?:p|li|ul|div)>",
    options: [.caseInsensitive]
  )
  private static let liStartRegex = try! NSRegularExpression(
    pattern: "<li\\b[^>]*>",
    options: [.caseInsensitive]
  )
  private static let tagRegex = try! NSRegularExpression(pattern: "<[^>]+>", options: [])

  static func parse(_ xmlBytes: [UInt8]) throws -> RefloatConfigSchema {
    let normalizedXmlBytes = normalizeXmlBytes(xmlBytes)
    let normalizedXml = String(decoding: normalizedXmlBytes, as: UTF8.self)
    if containsDocumentType(normalizedXml) {
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
      return try parseVescConfigParams(root, normalizedXmlBytes, normalizedXml)
    }

    let nodes = root.descendants(named: "param")
    if nodes.isEmpty { throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: no param nodes") }

    var offset = 0
    var fields: [RefloatConfigSchemaField] = []
    var seenIds = Set<String>()
    for node in nodes {
      let id = node.attribute("name") ?? node.attribute("id")
      guard let id, !id.isEmpty else {
        throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: param missing name")
      }
      if !seenIds.insert(id).inserted {
        throw RefloatConfigSchemaException(
          "UNSUPPORTED_SCHEMA: duplicate field id \(id)",
          code: .duplicateFieldId
        )
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
    return RefloatConfigSchema(hash: sha256(normalizedXmlBytes), fields: fields, rawXml: normalizedXml)
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

  static func stripQtHtml(_ raw: String) -> String? {
    guard !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    var text = raw
    text = replace(headRegex, in: text, with: "")
    text = replace(styleRegex, in: text, with: "")
    text = replace(doctypeRegex, in: text, with: "")
    text = replace(brRegex, in: text, with: "\n")
    text = replace(blockEndRegex, in: text, with: "\n")
    text = replace(liStartRegex, in: text, with: "- ")
    text = replace(tagRegex, in: text, with: "")
    text = text
      .replacingOccurrences(of: "&quot;", with: "\"")
      .replacingOccurrences(of: "&apos;", with: "'")
      .replacingOccurrences(of: "&#39;", with: "'")
      .replacingOccurrences(of: "&lt;", with: "<")
      .replacingOccurrences(of: "&gt;", with: ">")
      .replacingOccurrences(of: "&nbsp;", with: " ")
      .replacingOccurrences(of: "&amp;", with: "&")
      .replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n")
    var out: [String] = []
    for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
      let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.isEmpty {
        if let last = out.last, !last.isEmpty { out.append("") }
      } else {
        out.append(trimmed)
      }
    }
    while let last = out.last, last.isEmpty { out.removeLast() }
    return out.isEmpty ? nil : out.joined(separator: "\n")
  }

  private static func replace(_ regex: NSRegularExpression, in text: String, with template: String) -> String {
    let range = NSRange(text.startIndex..., in: text)
    return regex.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: template)
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
    _ xmlBytes: [UInt8],
    _ normalizedXml: String
  ) throws -> RefloatConfigSchema {
    guard let paramsNode = root.descendants(named: "Params").first else {
      throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: ConfigParams missing Params")
    }
    var params: [String: RefloatXmlNode] = [:]
    for child in paramsNode.children {
      if params[child.name] != nil {
        throw RefloatConfigSchemaException(
          "UNSUPPORTED_SCHEMA: duplicate field id \(child.name)",
          code: .duplicateFieldId
        )
      }
      params[child.name] = child
    }

    guard let orderNode = root.descendants(named: "SerOrder").first else {
      throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: ConfigParams missing SerOrder")
    }
    var order: [String] = []
    var seenOrder = Set<String>()
    for child in orderNode.children where child.name == "ser" {
      let name = child.textContent.trimmingCharacters(in: .whitespacesAndNewlines)
      if !seenOrder.insert(name).inserted {
        throw RefloatConfigSchemaException(
          "UNSUPPORTED_SCHEMA: duplicate field id \(name)",
          code: .duplicateFieldId
        )
      }
      order.append(name)
    }
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
      let vTx = text(node, "vTx").flatMap { Int($0) }
      let valueType = try parseVescValueType(type: type, vTx: vTx ?? 0, name: name)
      let defaultValue: RefloatConfigDefaultValue?
      if valueType == .bool {
        defaultValue = text(node, "valInt").flatMap { Int($0) }.map { .bool($0 != 0) }
      } else if let doubleVal = text(node, "valDouble").flatMap({ Double($0) }) {
        defaultValue = .number(doubleVal)
      } else if let intVal = text(node, "valInt").flatMap({ Double($0) }) {
        defaultValue = .number(intVal)
      } else if let stringVal = text(node, "valString")?.nilIfBlank {
        defaultValue = .string(stringVal)
      } else {
        defaultValue = nil
      }
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
          scale: text(node, "vTxDoubleScale").flatMap { Double($0) },
          xmlType: type,
          vTx: vTx,
          step: text(node, "stepDouble").flatMap { Double($0) }
            ?? text(node, "stepInt").flatMap { Double($0) },
          editorDecimals: text(node, "editorDecimalsDouble").flatMap { Int($0) },
          editorScale: text(node, "editorScale").flatMap { Double($0) },
          editAsPercentage: parseXmlBool(text(node, "editAsPercentage"), default: false),
          enumNames: directChildTexts(node, "enumNames"),
          defaultValue: defaultValue,
          transmittable: parseXmlBool(text(node, "transmittable"), default: true),
          showDisplay: parseXmlBool(text(node, "showDisplay"), default: false),
          cDefine: text(node, "cDefine")?.nilIfBlank,
          description: text(node, "description").flatMap { stripQtHtml($0) }
        )
      )
      offset += valueType.byteSize
    }
    let groups = parseGrouping(root, serializedIds: seenOrder)
    return RefloatConfigSchema(
      hash: sha256(xmlBytes),
      fields: fields,
      groups: groups,
      rawXml: normalizedXml
    )
  }

  private static func parseGrouping(
    _ root: RefloatXmlNode,
    serializedIds: Set<String>
  ) -> [RefloatConfigSchemaGroup] {
    guard let groupingNode = root.descendants(named: "Grouping").first else { return [] }
    var groups: [RefloatConfigSchemaGroup] = []
    for groupEl in directChildElements(groupingNode, "group") {
      let groupName = directChildText(groupEl, "groupName") ?? ""
      var subgroups: [RefloatConfigSchemaSubgroup] = []
      for subgroupEl in directChildElements(groupEl, "subgroup") {
        let subgroupName = directChildText(subgroupEl, "subgroupName") ?? ""
        var items: [RefloatConfigSchemaGroupItem] = []
        if let paramsEl = directChildElements(subgroupEl, "subgroupParams").first {
          for paramEl in directChildElements(paramsEl, "param") {
            let token = paramEl.textContent.trimmingCharacters(in: .whitespacesAndNewlines)
            if token.isEmpty { continue }
            if token.hasPrefix("::sep::") {
              let title = String(token.dropFirst("::sep::".count))
                .trimmingCharacters(in: .whitespacesAndNewlines)
              items.append(.separator(title))
            } else if serializedIds.contains(token) {
              items.append(.field(token))
            }
          }
        }
        if !subgroupName.isEmpty || !items.isEmpty {
          subgroups.append(RefloatConfigSchemaSubgroup(name: subgroupName, items: items))
        }
      }
      if !groupName.isEmpty || !subgroups.isEmpty {
        groups.append(RefloatConfigSchemaGroup(name: groupName, subgroups: subgroups))
      }
    }
    return groups
  }

  private static func directChildElements(_ parent: RefloatXmlNode, _ tag: String) -> [RefloatXmlNode] {
    parent.children.filter { $0.name == tag }
  }

  private static func directChildText(_ parent: RefloatXmlNode, _ tag: String) -> String? {
    directChildElements(parent, tag).first?.textContent.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func directChildTexts(_ parent: RefloatXmlNode, _ tag: String) -> [String] {
    directChildElements(parent, tag).map { $0.textContent.trimmingCharacters(in: .whitespacesAndNewlines) }
  }

  private static func parseXmlBool(_ raw: String?, default fallback: Bool) -> Bool {
    switch raw?.lowercased() {
    case "1", "true": return true
    case "0", "false": return false
    default: return fallback
    }
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
    case 4, 6:
      return .uint8
    case 5:
      return .bool
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
