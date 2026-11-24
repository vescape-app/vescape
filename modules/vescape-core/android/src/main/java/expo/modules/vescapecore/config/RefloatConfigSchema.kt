package expo.modules.vescapecore.config

import java.io.ByteArrayInputStream
import java.security.MessageDigest
import java.util.zip.InflaterInputStream
import javax.xml.parsers.DocumentBuilderFactory
import org.xml.sax.SAXException

// @parity /modules/vescape-core/ios/config/RefloatConfigSchema.swift
// @parity /modules/vescape-core/src/index.ts `BoardConfigValueType`
internal enum class RefloatConfigValueType(val byteSize: Int, val wire: String) {
  FLOAT32(4, "float32"),
  FLOAT32_SCALED(4, "float32_scaled"),
  FLOAT32_AUTO(4, "float32_auto"),
  FLOAT16_SCALED(2, "float16_scaled"),
  INT32(4, "int32"),
  UINT32(4, "uint32"),
  INT16(2, "int16"),
  UINT16(2, "uint16"),
  INT8(1, "int8"),
  UINT8(1, "uint8"),
  BOOL(1, "bool"),
}

// @parity /modules/vescape-core/ios/config/RefloatConfigSchema.swift `RefloatConfigSchemaErrorCode`
internal enum class RefloatConfigSchemaErrorCode {
  UNSUPPORTED_SCHEMA,
  DUPLICATE_FIELD_ID,
}

// @parity /modules/vescape-core/ios/config/RefloatConfigSchema.swift `RefloatConfigSchemaGroupItem`
// @parity /modules/vescape-core/src/index.ts `BoardConfigSchemaGroupItem`
internal sealed class RefloatConfigSchemaGroupItem {
  data class Separator(val title: String) : RefloatConfigSchemaGroupItem()
  data class Field(val fieldId: String) : RefloatConfigSchemaGroupItem()

  fun toBridgeMap(): Map<String, Any> = when (this) {
    is Separator -> mapOf("kind" to "separator", "title" to title)
    is Field -> mapOf("kind" to "field", "fieldId" to fieldId)
  }
}

// @parity /modules/vescape-core/ios/config/RefloatConfigSchema.swift `RefloatConfigSchemaSubgroup`
// @parity /modules/vescape-core/src/index.ts `BoardConfigSchemaSubgroup`
internal data class RefloatConfigSchemaSubgroup(
  val name: String,
  val items: List<RefloatConfigSchemaGroupItem>,
) {
  fun toBridgeMap(): Map<String, Any> = mapOf(
    "name" to name,
    "items" to items.map { it.toBridgeMap() },
  )
}

// @parity /modules/vescape-core/ios/config/RefloatConfigSchema.swift `RefloatConfigSchemaGroup`
// @parity /modules/vescape-core/src/index.ts `BoardConfigSchemaGroup`
internal data class RefloatConfigSchemaGroup(
  val name: String,
  val subgroups: List<RefloatConfigSchemaSubgroup>,
) {
  fun toBridgeMap(): Map<String, Any> = mapOf(
    "name" to name,
    "subgroups" to subgroups.map { it.toBridgeMap() },
  )
}

// @parity /modules/vescape-core/ios/config/RefloatConfigSchema.swift `RefloatConfigSchemaField`
// @parity /modules/vescape-core/src/index.ts `BoardConfigSchemaField`
internal data class RefloatConfigSchemaField(
  val id: String,
  val type: RefloatConfigValueType,
  val label: String,
  val unit: String?,
  val min: Double?,
  val max: Double?,
  val offset: Int,
  val scale: Double? = null,
  val xmlType: Int? = null,
  val vTx: Int? = null,
  val step: Double? = null,
  val editorDecimals: Int? = null,
  val editorScale: Double? = null,
  val editAsPercentage: Boolean = false,
  val enumNames: List<String> = emptyList(),
  val defaultValue: Any? = null,
  val transmittable: Boolean = true,
  val showDisplay: Boolean = false,
  val cDefine: String? = null,
  val description: String? = null,
) {
  fun toBridgeMap(): Map<String, Any?> = mapOf(
    "id" to id,
    "type" to type.wire,
    "xmlType" to xmlType,
    "vTx" to vTx,
    "label" to label,
    "unit" to unit,
    "min" to min,
    "max" to max,
    "offset" to offset,
    "scale" to scale,
    "step" to step,
    "editorDecimals" to editorDecimals,
    "editorScale" to editorScale,
    "editAsPercentage" to editAsPercentage,
    "enumNames" to enumNames,
    "defaultValue" to defaultValue,
    "transmittable" to transmittable,
    "showDisplay" to showDisplay,
    "cDefine" to cDefine,
    "description" to description,
  )
}

// @parity /modules/vescape-core/ios/config/RefloatConfigSchema.swift `RefloatConfigSchema`
// @parity /modules/vescape-core/src/index.ts `BoardConfigSchema`
internal data class RefloatConfigSchema(
  val hash: String,
  val fields: List<RefloatConfigSchemaField>,
  val groups: List<RefloatConfigSchemaGroup> = emptyList(),
  val rawXml: String = "",
) {
  fun toBridgeMap(): Map<String, Any> = mapOf(
    "hash" to hash,
    "fields" to fields.map { it.toBridgeMap() },
    "groups" to groups.map { it.toBridgeMap() },
  )
}

// @parity /modules/vescape-core/ios/config/RefloatConfigSchema.swift `RefloatConfigSchemaException`
internal class RefloatConfigSchemaException(
  message: String,
  val code: RefloatConfigSchemaErrorCode = RefloatConfigSchemaErrorCode.UNSUPPORTED_SCHEMA,
) : Exception(message)

internal object RefloatConfigSchemaParser {
  private val HEAD_REGEX = Regex("(?is)<head\\b[^>]*>.*?</head>")
  private val STYLE_REGEX = Regex("(?is)<style\\b[^>]*>.*?</style>")
  private val DOCTYPE_REGEX = Regex("(?is)<!doctype[^>]*>")
  private val BR_REGEX = Regex("(?i)<br\\s*/?>")
  private val BLOCK_END_REGEX = Regex("(?i)</(?:p|li|ul|div)>")
  private val LI_START_REGEX = Regex("(?i)<li\\b[^>]*>")
  private val TAG_REGEX = Regex("<[^>]+>")

  fun parse(xmlBytes: ByteArray): RefloatConfigSchema {
    val normalizedXmlBytes = normalizeXmlBytes(xmlBytes)
    val normalizedXml = String(normalizedXmlBytes, Charsets.UTF_8)
    if (containsDocumentType(normalizedXml)) {
      throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: document type declarations are forbidden")
    }
    val doc = try {
      val factory = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = false
        isIgnoringComments = true
      }
      val builder = factory.newDocumentBuilder().apply {
        setEntityResolver { _, _ -> throw SAXException("External XML entities are forbidden") }
      }
      builder.parse(ByteArrayInputStream(normalizedXmlBytes))
    } catch (e: Exception) {
      val preview = xmlBytes
        .take(96)
        .joinToString(" ") { "%02x".format(it) }
      val normalizedPreview = normalizedXmlBytes
        .take(96)
        .joinToString(" ") { "%02x".format(it) }
      throw RefloatConfigSchemaException(
        "UNSUPPORTED_SCHEMA: invalid XML (${e.message ?: e::class.java.simpleName}); rawPrefix=$preview; normalizedPrefix=$normalizedPreview",
      )
    }
    val configParams = doc.documentElement
    if (configParams.nodeName == "ConfigParams") {
      return parseVescConfigParams(doc, normalizedXmlBytes, normalizedXml)
    }

    val nodes = doc.getElementsByTagName("param")
    if (nodes.length == 0) throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: no param nodes")

    var offset = 0
    val fields = mutableListOf<RefloatConfigSchemaField>()
    val seenIds = HashSet<String>()
    for (i in 0 until nodes.length) {
      val node = nodes.item(i)
      val attrs = node.attributes
      val id = attr(attrs, "name") ?: attr(attrs, "id")
      if (id.isNullOrBlank()) throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: param missing name")
      if (!seenIds.add(id)) {
        throw RefloatConfigSchemaException(
          "UNSUPPORTED_SCHEMA: duplicate field id $id",
          RefloatConfigSchemaErrorCode.DUPLICATE_FIELD_ID,
        )
      }
      val type = parseType(attr(attrs, "type") ?: "float")
      val field = RefloatConfigSchemaField(
        id = id,
        type = type,
        label = attr(attrs, "label") ?: id,
        unit = attr(attrs, "unit")?.ifBlank { null },
        min = attr(attrs, "min")?.toDoubleOrNull(),
        max = attr(attrs, "max")?.toDoubleOrNull(),
        offset = offset,
      )
      fields.add(field)
      offset += type.byteSize
    }
    return RefloatConfigSchema(
      hash = sha256(normalizedXmlBytes),
      fields = fields,
      rawXml = normalizedXml,
    )
  }

  internal fun containsDocumentType(xml: String): Boolean {
    var cursor = 0
    val lower = xml.lowercase()
    while (true) {
      val marker = lower.indexOf("<!", cursor)
      if (marker < 0) return false
      when {
        lower.startsWith("<!--", marker) -> cursor = lower.indexOf("-->", marker + 4).let { if (it < 0) return false else it + 3 }
        lower.startsWith("<![cdata[", marker) -> cursor = lower.indexOf("]]>", marker + 9).let { if (it < 0) return false else it + 3 }
        lower.startsWith("<!doctype", marker) -> return true
        else -> cursor = marker + 2
      }
    }
  }

  internal fun stripQtHtml(raw: String): String? {
    if (raw.isBlank()) return null
    var text = raw
    text = HEAD_REGEX.replace(text, "")
    text = STYLE_REGEX.replace(text, "")
    text = DOCTYPE_REGEX.replace(text, "")
    text = BR_REGEX.replace(text, "\n")
    text = BLOCK_END_REGEX.replace(text, "\n")
    text = LI_START_REGEX.replace(text, "- ")
    text = TAG_REGEX.replace(text, "")
    text = text
      .replace("&quot;", "\"")
      .replace("&apos;", "'")
      .replace("&#39;", "'")
      .replace("&lt;", "<")
      .replace("&gt;", ">")
      .replace("&nbsp;", " ")
      .replace("&amp;", "&")
      .replace("\r\n", "\n")
      .replace("\r", "\n")
    val out = mutableListOf<String>()
    for (line in text.split('\n')) {
      val trimmed = line.trim()
      if (trimmed.isEmpty()) {
        if (out.isNotEmpty() && out.last().isNotEmpty()) out.add("")
      } else {
        out.add(trimmed)
      }
    }
    while (out.isNotEmpty() && out.last().isEmpty()) out.removeAt(out.lastIndex)
    return if (out.isEmpty()) null else out.joinToString("\n")
  }

  fun normalizeXmlBytes(bytes: ByteArray): ByteArray {
    val zlibStart = findZlibStart(bytes)
    if (zlibStart >= 0) {
      try {
        return InflaterInputStream(ByteArrayInputStream(bytes, zlibStart, bytes.size - zlibStart)).use {
          it.readBytes()
        }
      // intentional-suppression: failed compressed decode falls through to the raw XML decoder
      } catch (_: Exception) {
      }
    }

    val textStart = bytes.indexOfFirst { it.toInt().toChar() == '<' }
    if (textStart >= 0) return bytes.copyOfRange(textStart, bytes.size)

    return bytes
  }

  private fun findZlibStart(bytes: ByteArray): Int {
    for (i in 0 until bytes.size - 1) {
      val b0 = bytes[i].toInt() and 0xff
      val b1 = bytes[i + 1].toInt() and 0xff
      if (b0 == 0x78 && b1 in listOf(0x01, 0x5e, 0x9c, 0xda)) return i
    }
    return -1
  }

  private fun attr(attrs: org.w3c.dom.NamedNodeMap, name: String): String? =
    attrs.getNamedItem(name)?.nodeValue

  private fun parseVescConfigParams(
    doc: org.w3c.dom.Document,
    xmlBytes: ByteArray,
    normalizedXml: String,
  ): RefloatConfigSchema {
    val paramsNode = doc.getElementsByTagName("Params").item(0)
      ?: throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: ConfigParams missing Params")
    val params = mutableMapOf<String, org.w3c.dom.Element>()
    for (i in 0 until paramsNode.childNodes.length) {
      val child = paramsNode.childNodes.item(i)
      if (child is org.w3c.dom.Element) {
        if (params.put(child.nodeName, child) != null) {
          throw RefloatConfigSchemaException(
            "UNSUPPORTED_SCHEMA: duplicate field id ${child.nodeName}",
            RefloatConfigSchemaErrorCode.DUPLICATE_FIELD_ID,
          )
        }
      }
    }

    val orderNode = doc.getElementsByTagName("SerOrder").item(0)
      ?: throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: ConfigParams missing SerOrder")
    val order = mutableListOf<String>()
    val seenOrder = HashSet<String>()
    for (i in 0 until orderNode.childNodes.length) {
      val child = orderNode.childNodes.item(i)
      if (child is org.w3c.dom.Element && child.nodeName == "ser") {
        val name = child.textContent.trim()
        if (!seenOrder.add(name)) {
          throw RefloatConfigSchemaException(
            "UNSUPPORTED_SCHEMA: duplicate field id $name",
            RefloatConfigSchemaErrorCode.DUPLICATE_FIELD_ID,
          )
        }
        order.add(name)
      }
    }
    if (order.isEmpty()) throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: empty SerOrder")

    var offset = 0
    val fields = mutableListOf<RefloatConfigSchemaField>()
    for (name in order) {
      val node = params[name] ?: throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: serialized param missing $name")
      val type = text(node, "type")?.toIntOrNull()
        ?: throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: param $name missing type")
      val vTx = text(node, "vTx")?.toIntOrNull()
      val valueType = parseVescValueType(type, vTx ?: 0, name)
      val defaultValue: Any? = if (valueType == RefloatConfigValueType.BOOL) {
        text(node, "valInt")?.toIntOrNull()?.let { it != 0 }
      } else {
        text(node, "valDouble")?.toDoubleOrNull()
          ?: text(node, "valInt")?.toDoubleOrNull()
          ?: text(node, "valString")?.ifBlank { null }
      }
      val field = RefloatConfigSchemaField(
        id = name,
        type = valueType,
        label = text(node, "longName") ?: name,
        unit = text(node, "suffix")?.ifBlank { null },
        min = text(node, "minDouble")?.toDoubleOrNull() ?: text(node, "minInt")?.toDoubleOrNull(),
        max = text(node, "maxDouble")?.toDoubleOrNull() ?: text(node, "maxInt")?.toDoubleOrNull(),
        offset = offset,
        scale = text(node, "vTxDoubleScale")?.toDoubleOrNull(),
        xmlType = type,
        vTx = vTx,
        step = text(node, "stepDouble")?.toDoubleOrNull() ?: text(node, "stepInt")?.toDoubleOrNull(),
        editorDecimals = text(node, "editorDecimalsDouble")?.toIntOrNull(),
        editorScale = text(node, "editorScale")?.toDoubleOrNull(),
        editAsPercentage = parseXmlBool(text(node, "editAsPercentage"), default = false),
        enumNames = directChildTexts(node, "enumNames"),
        defaultValue = defaultValue,
        transmittable = parseXmlBool(text(node, "transmittable"), default = true),
        showDisplay = parseXmlBool(text(node, "showDisplay"), default = false),
        cDefine = text(node, "cDefine")?.ifBlank { null },
        description = text(node, "description")?.let(::stripQtHtml),
      )
      fields.add(field)
      offset += valueType.byteSize
    }
    val groups = parseGrouping(doc, seenOrder)
    return RefloatConfigSchema(
      hash = sha256(xmlBytes),
      fields = fields,
      groups = groups,
      rawXml = normalizedXml,
    )
  }

  private fun parseGrouping(
    doc: org.w3c.dom.Document,
    serializedIds: Set<String>,
  ): List<RefloatConfigSchemaGroup> {
    val groupingNode = doc.getElementsByTagName("Grouping").item(0) as? org.w3c.dom.Element ?: return emptyList()
    val groups = mutableListOf<RefloatConfigSchemaGroup>()
    for (groupEl in directChildElements(groupingNode, "group")) {
      val groupName = directChildText(groupEl, "groupName") ?: ""
      val subgroups = mutableListOf<RefloatConfigSchemaSubgroup>()
      for (subgroupEl in directChildElements(groupEl, "subgroup")) {
        val subgroupName = directChildText(subgroupEl, "subgroupName") ?: ""
        val items = mutableListOf<RefloatConfigSchemaGroupItem>()
        val paramsEl = directChildElements(subgroupEl, "subgroupParams").firstOrNull()
        if (paramsEl != null) {
          for (paramEl in directChildElements(paramsEl, "param")) {
            val token = paramEl.textContent.trim()
            if (token.isEmpty()) continue
            if (token.startsWith("::sep::")) {
              items.add(RefloatConfigSchemaGroupItem.Separator(token.removePrefix("::sep::").trim()))
            } else if (token in serializedIds) {
              items.add(RefloatConfigSchemaGroupItem.Field(token))
            }
          }
        }
        if (subgroupName.isNotEmpty() || items.isNotEmpty()) {
          subgroups.add(RefloatConfigSchemaSubgroup(name = subgroupName, items = items))
        }
      }
      if (groupName.isNotEmpty() || subgroups.isNotEmpty()) {
        groups.add(RefloatConfigSchemaGroup(name = groupName, subgroups = subgroups))
      }
    }
    return groups
  }

  private fun directChildElements(parent: org.w3c.dom.Element, tag: String): List<org.w3c.dom.Element> {
    val result = mutableListOf<org.w3c.dom.Element>()
    for (i in 0 until parent.childNodes.length) {
      val child = parent.childNodes.item(i)
      if (child is org.w3c.dom.Element && child.nodeName == tag) result.add(child)
    }
    return result
  }

  private fun directChildText(parent: org.w3c.dom.Element, tag: String): String? =
    directChildElements(parent, tag).firstOrNull()?.textContent?.trim()

  private fun directChildTexts(parent: org.w3c.dom.Element, tag: String): List<String> =
    directChildElements(parent, tag).map { it.textContent.trim() }

  private fun parseXmlBool(raw: String?, default: Boolean): Boolean = when (raw?.lowercase()) {
    "1", "true" -> true
    "0", "false" -> false
    else -> default
  }

  private fun text(parent: org.w3c.dom.Element, tag: String): String? =
    directChildText(parent, tag)

  private fun parseVescValueType(type: Int, vTx: Int, name: String): RefloatConfigValueType {
    return when (type) {
      1 -> when (vTx) {
        7 -> RefloatConfigValueType.FLOAT16_SCALED
        8 -> RefloatConfigValueType.FLOAT32_SCALED
        9 -> RefloatConfigValueType.FLOAT32_AUTO
        else -> throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: double $name has tx $vTx")
      }
      2 -> when (vTx) {
        1 -> RefloatConfigValueType.UINT8
        2 -> RefloatConfigValueType.INT8
        3 -> RefloatConfigValueType.UINT16
        4 -> RefloatConfigValueType.INT16
        5 -> RefloatConfigValueType.UINT32
        6 -> RefloatConfigValueType.INT32
        else -> throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: int $name has tx $vTx")
      }
      4, 6 -> RefloatConfigValueType.UINT8
      5 -> RefloatConfigValueType.BOOL
      else -> throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: unsupported ConfigParams type $type for $name")
    }
  }

  private fun parseType(raw: String): RefloatConfigValueType = when (raw.lowercase()) {
    "float", "float32", "f32" -> RefloatConfigValueType.FLOAT32
    "int", "int32", "i32" -> RefloatConfigValueType.INT32
    "uint", "uint32", "u32" -> RefloatConfigValueType.UINT32
    "int16", "i16" -> RefloatConfigValueType.INT16
    "uint16", "u16" -> RefloatConfigValueType.UINT16
    "int8", "i8" -> RefloatConfigValueType.INT8
    "uint8", "u8" -> RefloatConfigValueType.UINT8
    "bool", "boolean" -> RefloatConfigValueType.BOOL
    else -> throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: unknown type $raw")
  }

  private fun sha256(bytes: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    return digest.joinToString("") { "%02x".format(it) }
  }
}
