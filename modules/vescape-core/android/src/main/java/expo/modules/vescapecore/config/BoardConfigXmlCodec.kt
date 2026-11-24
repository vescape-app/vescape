package expo.modules.vescapecore.config

import java.io.ByteArrayInputStream
import java.math.BigDecimal
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.math.abs
import kotlin.math.floor
import org.xml.sax.SAXException

// @parity /modules/vescape-core/ios/config/BoardConfigXmlCodec.swift `BoardConfigXmlImportPlan`
// @parity /modules/vescape-core/src/index.ts `BoardConfigXmlImportPlan`
internal data class BoardConfigXmlImportPlan(
  val boardId: String,
  val configVersion: Int?,
  val currentSchemaHash: String,
  val changes: Map<String, Any>,
  val skippedFields: List<BoardConfigRevertSkippedField>,
) {
  fun toBridgeMap(): Map<String, Any?> = mapOf(
    "boardId" to boardId,
    "configVersion" to configVersion,
    "currentSchemaHash" to currentSchemaHash,
    "changes" to changes,
    "skippedFields" to skippedFields.map { it.toBridgeMap() },
  )
}

// @parity /modules/vescape-core/ios/config/BoardConfigXmlCodec.swift
internal object BoardConfigXmlCodec {
  const val VESC_TOOL_CONFIG_VERSION = 4
  const val CUSTOM_CONFIG_ROOT = "CustomConfiguration"
  const val CONFIG_VERSION_TAG = "ConfigVersion"

  fun exportXml(
    schema: RefloatConfigSchema,
    rawConfig: ByteArray,
  ): String {
    val decoded = RefloatConfigFieldDecoder.decodeFieldMap(schema, rawConfig)
    val sb = StringBuilder()
    sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
    sb.append("<").append(CUSTOM_CONFIG_ROOT).append(">\n")
    sb.append("    <").append(CONFIG_VERSION_TAG).append(">")
      .append(VESC_TOOL_CONFIG_VERSION)
      .append("</").append(CONFIG_VERSION_TAG).append(">\n")

    for (field in schema.fields) {
      val value = decoded[field.id] ?: continue
      val serialized = formatXmlValue(field, value) ?: continue
      sb.append("    <").append(field.id).append(">")
        .append(escapeXml(serialized))
        .append("</").append(field.id).append(">\n")
    }

    sb.append("</").append(CUSTOM_CONFIG_ROOT).append(">\n")
    return sb.toString()
  }

  fun planImport(
    boardId: String,
    currentSchema: RefloatConfigSchema,
    currentRawConfig: ByteArray,
    xml: String,
    overlay: RefloatFieldOverlay = RefloatFieldOverlay.shared,
  ): BoardConfigXmlImportPlan {
    if (xml.isBlank()) {
      throw invalidXml("XML content is empty")
    }
    if (RefloatConfigSchemaParser.containsDocumentType(xml)) {
      throw invalidXml("Document type declarations are forbidden")
    }

    val doc = try {
      val factory = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = false
        isIgnoringComments = true
      }
      val builder = factory.newDocumentBuilder().apply {
        setEntityResolver { _, _ -> throw SAXException("External XML entities are forbidden") }
      }
      builder.parse(ByteArrayInputStream(xml.toByteArray(Charsets.UTF_8)))
    } catch (error: Exception) {
      throw invalidXml("Invalid XML (${error.message ?: error::class.java.simpleName})")
    }

    val root = doc.documentElement
      ?: throw invalidXml("Missing root element")
    if (root.nodeName != CUSTOM_CONFIG_ROOT) {
      throw invalidXml("Expected <$CUSTOM_CONFIG_ROOT> root element, found <${root.nodeName}>")
    }

    var configVersion: Int? = null
    val parsedEntries = LinkedHashMap<String, String>()
    for (i in 0 until root.childNodes.length) {
      val child = root.childNodes.item(i)
      if (child !is org.w3c.dom.Element) continue
      val name = child.nodeName
      val text = child.textContent.trim()
      if (name == CONFIG_VERSION_TAG) {
        val parsedVersion = text.toIntOrNull()
        if (parsedVersion != VESC_TOOL_CONFIG_VERSION) {
          throw invalidXml("Unsupported ConfigVersion: $text (expected $VESC_TOOL_CONFIG_VERSION)")
        }
        configVersion = parsedVersion
        continue
      }
      parsedEntries[name] = text
    }

    val internalSchemaIds = RefloatConfigEncoder.collectInternalSchemaFieldIds(currentSchema)
    val currentById = currentSchema.fields.associateBy { it.id }

    val changes = LinkedHashMap<String, Any>()
    val skippedFields = mutableListOf<BoardConfigRevertSkippedField>()

    for ((fieldId, rawText) in parsedEntries) {
      if (RefloatConfigEncoder.isInternalField(fieldId, internalSchemaIds, overlay)) continue

      val currentField = currentById[fieldId]
      if (currentField == null) {
        skippedFields.add(
          BoardConfigRevertSkippedField(
            fieldId = fieldId,
            label = fieldId,
            reason = "Not in current firmware schema",
          ),
        )
        continue
      }

      val size = currentField.type.byteSize
      if (currentField.offset < 0 || currentRawConfig.size < currentField.offset + size) {
        skippedFields.add(
          BoardConfigRevertSkippedField(
            fieldId = fieldId,
            label = currentField.label,
            reason = "Exceeds current config buffer size",
          ),
        )
        continue
      }

      val candidateValue = parseCandidateValue(currentField, rawText)
      if (candidateValue == null) {
        skippedFields.add(
          BoardConfigRevertSkippedField(
            fieldId = fieldId,
            label = currentField.label,
            reason = if (currentField.type == RefloatConfigValueType.BOOL) {
              "Invalid boolean value: $rawText"
            } else {
              "Invalid numeric value: $rawText"
            },
          ),
        )
        continue
      }

      val encodedBytes = try {
        RefloatConfigEncoder.encodeFieldBytes(currentField, candidateValue, overlay)
      } catch (error: RefloatConfigEncodeException) {
        skippedFields.add(
          BoardConfigRevertSkippedField(
            fieldId = fieldId,
            label = currentField.label,
            reason = error.message ?: "Value is not valid for current firmware",
          ),
        )
        continue
      }

      if (!matchesBytes(currentRawConfig, currentField.offset, encodedBytes)) {
        changes[currentField.id] = candidateValue
      }
    }

    return BoardConfigXmlImportPlan(
      boardId = boardId,
      configVersion = configVersion,
      currentSchemaHash = currentSchema.hash,
      changes = changes,
      skippedFields = skippedFields,
    )
  }

  private fun formatXmlValue(field: RefloatConfigSchemaField, value: Any): String? {
    if (field.type == RefloatConfigValueType.BOOL) {
      return when (value) {
        is Boolean -> if (value) "1" else "0"
        is Number -> if (value.toDouble() != 0.0) "1" else "0"
        else -> null
      }
    }
    val number = (value as? Number)?.toDouble()?.takeIf { it.isFinite() } ?: return null
    val normalized = if (number == 0.0) 0.0 else number
    return when (field.type) {
      RefloatConfigValueType.INT32,
      RefloatConfigValueType.UINT32,
      RefloatConfigValueType.INT16,
      RefloatConfigValueType.UINT16,
      RefloatConfigValueType.INT8,
      RefloatConfigValueType.UINT8 -> normalized.toLong().toString()
      RefloatConfigValueType.FLOAT32,
      RefloatConfigValueType.FLOAT32_SCALED,
      RefloatConfigValueType.FLOAT32_AUTO,
      RefloatConfigValueType.FLOAT16_SCALED -> formatDouble(normalized)
      RefloatConfigValueType.BOOL -> if (normalized != 0.0) "1" else "0"
    }
  }

  private val strictDecimalRegex = Regex("^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?$")

  private fun formatDouble(value: Double): String {
    if (value == 0.0) return "0"
    if (floor(value) == value && abs(value) < 1e15) {
      return value.toLong().toString()
    }
    if (abs(value) >= 1e-12 && abs(value) < 1e15) {
      return BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()
    }
    return value.toString()
  }

  private fun parseCandidateValue(field: RefloatConfigSchemaField, rawText: String): Any? {
    if (field.type == RefloatConfigValueType.BOOL) {
      return when (rawText.lowercase()) {
        "1", "true" -> true
        "0", "false" -> false
        else -> null
      }
    }
    if (!strictDecimalRegex.matches(rawText)) return null
    val parsed = rawText.toDoubleOrNull() ?: return null
    if (!parsed.isFinite()) return null
    return if (parsed == 0.0) 0.0 else parsed
  }

  private fun escapeXml(raw: String): String = raw
    .replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
    .replace("\"", "&quot;")
    .replace("'", "&apos;")

  private fun matchesBytes(rawConfig: ByteArray, offset: Int, encodedBytes: ByteArray): Boolean {
    for (i in encodedBytes.indices) {
      if (rawConfig[offset + i] != encodedBytes[i]) return false
    }
    return true
  }

  private fun invalidXml(message: String) =
    RefloatConfigEncodeException(RefloatConfigErrorCode.INVALID_CONFIG_XML, message)
}
