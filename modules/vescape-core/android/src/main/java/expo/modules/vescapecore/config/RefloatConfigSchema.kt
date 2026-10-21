package expo.modules.vescapecore.config

import java.io.ByteArrayInputStream
import java.security.MessageDigest
import java.util.zip.InflaterInputStream
import javax.xml.parsers.DocumentBuilderFactory
import org.xml.sax.SAXException

// @parity /modules/vescape-core/ios/config/RefloatConfigSchema.swift
internal enum class RefloatConfigValueType(val byteSize: Int) {
  FLOAT32(4),
  FLOAT32_SCALED(4),
  FLOAT32_AUTO(4),
  FLOAT16_SCALED(2),
  INT32(4),
  UINT32(4),
  INT16(2),
  UINT16(2),
  INT8(1),
  UINT8(1),
  BOOL(1),
}

internal data class RefloatConfigSchemaField(
  val id: String,
  val type: RefloatConfigValueType,
  val label: String,
  val unit: String?,
  val min: Double?,
  val max: Double?,
  val offset: Int,
  val scale: Double? = null,
)

internal data class RefloatConfigSchema(
  val hash: String,
  val fields: List<RefloatConfigSchemaField>,
)

internal class RefloatConfigSchemaException(message: String) : Exception(message)

internal object RefloatConfigSchemaParser {
  fun parse(xmlBytes: ByteArray): RefloatConfigSchema {
    val normalizedXmlBytes = normalizeXmlBytes(xmlBytes)
    if (containsDocumentType(String(normalizedXmlBytes, Charsets.UTF_8))) {
      throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: document type declarations are forbidden")
    }
    val doc = try {
      val factory = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = false
        isIgnoringComments = true
      }
      // Android's DOM provider rejects the SAX external-entity feature flags supported by the JVM.
      // Reject DTDs above and external resolution here without relying on optional parser features.
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
      return parseVescConfigParams(doc, normalizedXmlBytes)
    }

    val nodes = doc.getElementsByTagName("param")
    if (nodes.length == 0) throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: no param nodes")

    var offset = 0
    val fields = mutableListOf<RefloatConfigSchemaField>()
    for (i in 0 until nodes.length) {
      val node = nodes.item(i)
      val attrs = node.attributes
      val id = attr(attrs, "name") ?: attr(attrs, "id")
      if (id.isNullOrBlank()) throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: param missing name")
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
    return RefloatConfigSchema(hash = sha256(normalizedXmlBytes), fields = fields)
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

  private fun parseVescConfigParams(doc: org.w3c.dom.Document, xmlBytes: ByteArray): RefloatConfigSchema {
    val paramsNode = doc.getElementsByTagName("Params").item(0)
      ?: throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: ConfigParams missing Params")
    val params = mutableMapOf<String, org.w3c.dom.Element>()
    for (i in 0 until paramsNode.childNodes.length) {
      val child = paramsNode.childNodes.item(i)
      if (child is org.w3c.dom.Element) params[child.nodeName] = child
    }

    val orderNode = doc.getElementsByTagName("SerOrder").item(0)
      ?: throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: ConfigParams missing SerOrder")
    val order = mutableListOf<String>()
    for (i in 0 until orderNode.childNodes.length) {
      val child = orderNode.childNodes.item(i)
      if (child is org.w3c.dom.Element && child.nodeName == "ser") {
        order.add(child.textContent.trim())
      }
    }
    if (order.isEmpty()) throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: empty SerOrder")

    var offset = 0
    val fields = mutableListOf<RefloatConfigSchemaField>()
    for (name in order) {
      val node = params[name] ?: throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: serialized param missing $name")
      val type = text(node, "type")?.toIntOrNull()
        ?: throw RefloatConfigSchemaException("UNSUPPORTED_SCHEMA: param $name missing type")
      val vTx = text(node, "vTx")?.toIntOrNull() ?: 0
      val valueType = parseVescValueType(type, vTx, name)
      val field = RefloatConfigSchemaField(
        id = name,
        type = valueType,
        label = text(node, "longName") ?: name,
        unit = text(node, "suffix")?.ifBlank { null },
        min = text(node, "minDouble")?.toDoubleOrNull() ?: text(node, "minInt")?.toDoubleOrNull(),
        max = text(node, "maxDouble")?.toDoubleOrNull() ?: text(node, "maxInt")?.toDoubleOrNull(),
        offset = offset,
        scale = text(node, "vTxDoubleScale")?.toDoubleOrNull(),
      )
      fields.add(field)
      offset += valueType.byteSize
    }
    return RefloatConfigSchema(hash = sha256(xmlBytes), fields = fields)
  }

  private fun text(parent: org.w3c.dom.Element, tag: String): String? {
    val nodes = parent.getElementsByTagName(tag)
    if (nodes.length == 0) return null
    return nodes.item(0).textContent.trim()
  }

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
      4, 5, 6 -> RefloatConfigValueType.INT8
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
