import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigXmlCodec.kt `BoardConfigXmlImportPlan`
/// @parity /modules/vescape-core/src/index.ts `BoardConfigXmlImportPlan`
struct BoardConfigXmlImportPlan {
  let boardId: String
  let configVersion: Int?
  let currentSchemaHash: String
  let changes: [String: Any]
  let skippedFields: [BoardConfigRevertSkippedField]

  func toBridgeMap() -> [String: Any?] {
    [
      "boardId": boardId,
      "configVersion": configVersion,
      "currentSchemaHash": currentSchemaHash,
      "changes": changes,
      "skippedFields": skippedFields.map { $0.toBridgeMap() },
    ]
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigXmlCodec.kt
enum BoardConfigXmlCodec {
  static let vescToolConfigVersion = 4
  static let customConfigRoot = "CustomConfiguration"
  static let configVersionTag = "ConfigVersion"

  static func exportXml(
    schema: RefloatConfigSchema,
    rawConfig: [UInt8]
  ) -> String {
    let decoded = RefloatConfigFieldDecoder.decodeFieldMap(schema: schema, rawConfig: rawConfig)
    var lines: [String] = [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<\(customConfigRoot)>",
      "    <\(configVersionTag)>\(vescToolConfigVersion)</\(configVersionTag)>",
    ]

    for field in schema.fields {
      guard let value = decoded[field.id],
            let serialized = formatXmlValue(field, value) else {
        continue
      }
      lines.append("    <\(field.id)>\(escapeXml(serialized))</\(field.id)>")
    }

    lines.append("</\(customConfigRoot)>")
    return lines.joined(separator: "\n") + "\n"
  }

  static func planImport(
    boardId: String,
    currentSchema: RefloatConfigSchema,
    currentRawConfig: [UInt8],
    xml: String,
    overlay: RefloatFieldOverlay = .shared
  ) throws -> BoardConfigXmlImportPlan {
    if xml.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      throw invalidXml("XML content is empty")
    }
    if RefloatConfigSchemaParser.containsDocumentType(xml) {
      throw invalidXml("Document type declarations are forbidden")
    }

    let root: RefloatXmlNode
    do {
      root = try RefloatXmlNode.parse(Data(xml.utf8))
    } catch let error as RefloatXmlError {
      throw invalidXml("Invalid XML (\(error.message))")
    } catch {
      throw invalidXml("Invalid XML (\(error.localizedDescription))")
    }

    guard root.name == customConfigRoot else {
      throw invalidXml("Expected <\(customConfigRoot)> root element, found <\(root.name)>")
    }

    var configVersion: Int?
    var orderedIds: [String] = []
    var parsedValues: [String: String] = [:]
    for child in root.children {
      let name = child.name
      let text = child.textContent.trimmingCharacters(in: .whitespacesAndNewlines)
      if name == configVersionTag {
        configVersion = Int(text)
        continue
      }
      if parsedValues[name] == nil {
        orderedIds.append(name)
      }
      parsedValues[name] = text
    }

    let internalSchemaIds = collectInternalSchemaFieldIds(currentSchema)
    let currentById = Dictionary(uniqueKeysWithValues: currentSchema.fields.map { ($0.id, $0) })

    var changes: [String: Any] = [:]
    var skippedFields: [BoardConfigRevertSkippedField] = []

    for fieldId in orderedIds {
      let rawText = parsedValues[fieldId] ?? ""
      if isInternalField(fieldId, internalSchemaIds: internalSchemaIds, overlay: overlay) {
        continue
      }

      guard let currentField = currentById[fieldId] else {
        skippedFields.append(
          BoardConfigRevertSkippedField(
            fieldId: fieldId,
            label: fieldId,
            reason: "Not in current firmware schema"
          )
        )
        continue
      }

      let size = currentField.type.byteSize
      if currentField.offset < 0 || currentRawConfig.count < currentField.offset + size {
        skippedFields.append(
          BoardConfigRevertSkippedField(
            fieldId: fieldId,
            label: currentField.label,
            reason: "Exceeds current config buffer size"
          )
        )
        continue
      }

      guard let candidateValue = parseCandidateValue(currentField, rawText) else {
        skippedFields.append(
          BoardConfigRevertSkippedField(
            fieldId: fieldId,
            label: currentField.label,
            reason: currentField.type == .bool
              ? "Invalid boolean value: \(rawText)"
              : "Invalid numeric value: \(rawText)"
          )
        )
        continue
      }

      let encodedBytes: [UInt8]
      do {
        encodedBytes = try RefloatConfigEncoder.encodeFieldBytes(currentField, candidateValue, overlay: overlay)
      } catch let error as RefloatConfigEncodeException {
        skippedFields.append(
          BoardConfigRevertSkippedField(
            fieldId: fieldId,
            label: currentField.label,
            reason: error.message
          )
        )
        continue
      } catch {
        skippedFields.append(
          BoardConfigRevertSkippedField(
            fieldId: fieldId,
            label: currentField.label,
            reason: "Value is not valid for current firmware"
          )
        )
        continue
      }

      if !matchesBytes(currentRawConfig, offset: currentField.offset, encodedBytes: encodedBytes) {
        changes[currentField.id] = candidateValue
      }
    }

    return BoardConfigXmlImportPlan(
      boardId: boardId,
      configVersion: configVersion,
      currentSchemaHash: currentSchema.hash,
      changes: changes,
      skippedFields: skippedFields
    )
  }

  private static func formatXmlValue(_ field: RefloatConfigSchemaField, _ value: Any) -> String? {
    if field.type == .bool {
      if let flag = value as? Bool { return flag ? "1" : "0" }
      if let number = value as? Double { return number != 0 ? "1" : "0" }
      return nil
    }
    guard let number = value as? Double, number.isFinite else { return nil }
    let normalized = number == 0 ? 0.0 : number
    switch field.type {
    case .int32, .uint32, .int16, .uint16, .int8, .uint8:
      return String(Int64(normalized))
    case .float32, .float32Scaled, .float32Auto, .float16Scaled:
      return formatDouble(normalized)
    case .bool:
      return normalized != 0 ? "1" : "0"
    }
  }

  private static func formatDouble(_ value: Double) -> String {
    if value == 0 { return "0" }
    if value.rounded(.down) == value && abs(value) < 1e15 {
      return String(Int64(value))
    }
    return String(value)
  }

  private static func parseCandidateValue(_ field: RefloatConfigSchemaField, _ rawText: String) -> Any? {
    if field.type == .bool {
      switch rawText.lowercased() {
      case "1", "true": return true
      case "0", "false": return false
      default: return nil
      }
    }
    guard let parsed = Double(rawText), parsed.isFinite else { return nil }
    return parsed == 0 ? 0.0 : parsed
  }

  private static func escapeXml(_ raw: String) -> String {
    raw
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\"", with: "&quot;")
      .replacingOccurrences(of: "'", with: "&apos;")
  }

  private static func isInternalField(
    _ fieldId: String,
    internalSchemaIds: Set<String>,
    overlay: RefloatFieldOverlay
  ) -> Bool {
    overlay.isInternal(fieldId) || fieldId.hasPrefix("meta.") || internalSchemaIds.contains(fieldId)
  }

  private static func collectInternalSchemaFieldIds(_ schema: RefloatConfigSchema) -> Set<String> {
    var ids = Set<String>()
    for group in schema.groups {
      let groupInternal = group.name.caseInsensitiveCompare("internal") == .orderedSame
      for subgroup in group.subgroups {
        if !groupInternal && subgroup.name.caseInsensitiveCompare("meta") != .orderedSame { continue }
        for item in subgroup.items {
          if case let .field(fieldId) = item { ids.insert(fieldId) }
        }
      }
    }
    return ids
  }

  private static func matchesBytes(_ rawConfig: [UInt8], offset: Int, encodedBytes: [UInt8]) -> Bool {
    for i in 0..<encodedBytes.count {
      if rawConfig[offset + i] != encodedBytes[i] { return false }
    }
    return true
  }

  private static func invalidXml(_ message: String) -> RefloatConfigEncodeException {
    RefloatConfigEncodeException(.INVALID_CONFIG_XML, message)
  }
}
