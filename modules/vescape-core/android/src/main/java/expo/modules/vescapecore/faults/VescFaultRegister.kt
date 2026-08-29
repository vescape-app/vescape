package expo.modules.vescapecore.faults

import org.json.JSONArray
import org.json.JSONObject

/**
 * Why Vescape asked the controller for its retained fault register.
 *
 * The reason is durable evidence metadata, not scheduling state: it says what the read was for, so a
 * baseline can never be mistaken for a discovery and an idle sweep can never be mistaken for the
 * immediate answer to a live fault.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultRegister.swift `VescFaultRegisterReason`
 * @parity /modules/vescape-core/src/index.ts `VescFaultRegisterReason`
 */
enum class VescFaultRegisterReason(val wire: String) {
  /** First read after a link/re-link, or a Board saved before the feature existed. */
  BASELINE("baseline"),

  /** A Board Session became ready. */
  CONNECT("connect"),

  /** Immediately after a live Refloat fault trigger. */
  LIVE("live"),

  /** The Board has been standing still long enough that a terminal read is safe. */
  STATIONARY("stationary"),

  /** Best effort while an intentional disconnect is being torn down. */
  PREDISCONNECT("predisconnect"),

  /** Infrequent fallback so a long quiet session still audits the register. */
  IDLE("idle");

  companion object {
    fun fromWire(value: String): VescFaultRegisterReason =
      entries.firstOrNull { it.wire == value } ?: IDLE
  }
}

/**
 * How a terminal read ended. `COMM_PRINT` has no completion frame, so this is the only honest
 * statement Vescape can make about the bytes it holds.
 *
 * An [INCOMPLETE] read is still evidence — the partial bytes are kept — but it never proves an empty
 * register and never produces an occurrence.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultRegister.swift `VescFaultRegisterStatus`
 * @parity /modules/vescape-core/src/index.ts `VescFaultRegisterStatus`
 */
enum class VescFaultRegisterStatus(val wire: String) {
  /** Output settled: the controller went quiet for a full idle boundary after answering. */
  COMPLETE("complete"),

  /** The hard bound elapsed while output was still arriving, or nothing arrived at all. */
  INCOMPLETE("incomplete");

  companion object {
    fun fromWire(value: String): VescFaultRegisterStatus =
      entries.firstOrNull { it.wire == value } ?: INCOMPLETE
  }
}

/**
 * One parsed fault block out of the controller's register.
 *
 * A **projection** of [VescFaultRegisterSnapshot.raw], never a replacement for it: [fields] keeps
 * every `Label : value` line the firmware printed, including ones Vescape has no meaning for, and
 * [rawBlock] keeps the block verbatim. [code] is null when the firmware named a fault this build
 * does not know.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultRegister.swift `VescFaultRegisterEntry`
 * @parity /modules/vescape-core/src/index.ts `VescFaultRegisterEntry`
 */
data class VescFaultRegisterEntry(
  /** Controller order, oldest printed block first. Preserved so register-only faults keep it. */
  val position: Int,
  /** VESC `mc_fault_code` resolved from [name], or null for a name this build does not know. */
  val code: Int?,
  /** The firmware's own fault name, e.g. `FAULT_CODE_ABS_OVER_CURRENT`. Always kept verbatim. */
  val name: String,
  /** Every labelled line of the block, in print order. Unknown labels survive here. */
  val fields: List<Pair<String, String>>,
  /** The block exactly as printed, so a parser change can never lose the original. */
  val rawBlock: String,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "position" to position,
    "code" to code,
    "name" to name,
    "fields" to fields.map { mapOf("label" to it.first, "value" to it.second) },
    "rawBlock" to rawBlock,
  )

  internal fun toJson(): JSONObject = JSONObject().apply {
    put("position", position)
    put("code", code ?: JSONObject.NULL)
    put("name", name)
    put("rawBlock", rawBlock)
    put(
      "fields",
      JSONArray().apply {
        for ((label, value) in fields) {
          put(JSONObject().apply { put("label", label); put("value", value) })
        }
      },
    )
  }

  internal companion object {
    fun fromJson(json: JSONObject): VescFaultRegisterEntry {
      val fields = ArrayList<Pair<String, String>>()
      val array = json.optJSONArray("fields") ?: JSONArray()
      for (index in 0 until array.length()) {
        val field = array.getJSONObject(index)
        fields.add(field.optString("label") to field.optString("value"))
      }
      return VescFaultRegisterEntry(
        position = json.optInt("position"),
        code = if (json.isNull("code")) null else json.optInt("code"),
        name = json.optString("name"),
        fields = fields,
        rawBlock = json.optString("rawBlock"),
      )
    }
  }
}

/**
 * One retained read of the controller's fault register.
 *
 * [raw] is the authority. [text] and [entries] are conveniences derived from it, and [entries] is
 * null whenever the parser could not make sense of the output — a parser that fails must never cost
 * Vescape the bytes the controller actually sent.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultRegister.swift `VescFaultRegisterSnapshot`
 * @parity /modules/vescape-core/src/index.ts `VescFaultRegisterSnapshot`
 */
data class VescFaultRegisterSnapshot(
  val id: String,
  val boardId: String,
  val readAtMs: Long,
  val reason: VescFaultRegisterReason,
  val status: VescFaultRegisterStatus,
  /** Exact `COMM_PRINT` payload bytes, concatenated in arrival order. */
  val raw: ByteArray,
  /** Lossy display projection of [raw]. */
  val text: String,
  /** Parsed blocks, or null when the output could not be parsed. Empty = register proven empty. */
  val entries: List<VescFaultRegisterEntry>?,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "id" to id,
    "boardId" to boardId,
    "readAtMs" to readAtMs,
    "reason" to reason.wire,
    "status" to status.wire,
    "byteCount" to raw.size,
    "text" to text,
    "entries" to entries?.map { it.toMap() },
  )

  override fun equals(other: Any?): Boolean =
    other is VescFaultRegisterSnapshot && id == other.id

  override fun hashCode(): Int = id.hashCode()
}

/**
 * Turns VESC's `faults` terminal output into fault blocks.
 *
 * Deliberately forgiving: firmware output varies by version and build, so any labelled line is kept
 * even when Vescape has no meaning for it, and an unrecognised shape returns null rather than an
 * empty register. Only [parse] returning an empty list means "the controller has no faults".
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultRegister.swift `VescFaultRegisterParser`
 */
object VescFaultRegisterParser {
  /** The label that opens a fault block in VESC's `terminal.c` fault dump. */
  private const val FAULT_LABEL = "Fault"

  /**
   * Parse complete terminal output.
   *
   * @return the blocks in controller order, an empty list when the controller stated it has no
   *   faults, or null when the output matched neither shape (kept as raw evidence only).
   */
  fun parse(text: String): List<VescFaultRegisterEntry>? {
    val normalized = text.replace("\r\n", "\n").replace('\r', '\n')
    val lines = normalized.split('\n')
    val blocks = ArrayList<MutableList<Pair<String, String>>>()
    val blockLines = ArrayList<MutableList<String>>()
    for (line in lines) {
      val trimmed = line.trim()
      if (trimmed.isEmpty()) continue
      val label = labelOf(trimmed)
      if (label != null && label.first.equals(FAULT_LABEL, ignoreCase = true)) {
        blocks.add(mutableListOf(label))
        blockLines.add(mutableListOf(trimmed))
        continue
      }
      val current = blocks.lastOrNull() ?: continue
      blockLines.last().add(trimmed)
      // Unlabelled continuation lines still belong to the block: keep them under an empty label so
      // the projection never silently drops firmware output.
      current.add(label ?: ("" to trimmed))
    }
    if (blocks.isEmpty()) {
      // VESC prints "No faults registered since startup" for an empty register. Only that explicit
      // statement proves emptiness — anything else is unparsed evidence.
      return if (normalized.contains("no faults", ignoreCase = true)) emptyList() else null
    }
    return blocks.mapIndexed { index, fields ->
      val name = fields.first().second
      VescFaultRegisterEntry(
        position = index,
        code = faultCodeForName(name),
        name = name,
        fields = fields,
        rawBlock = blockLines[index].joinToString("\n"),
      )
    }
  }

  /** Splits `Label : value`. Returns null for a line without a separator. */
  private fun labelOf(line: String): Pair<String, String>? {
    val separator = line.indexOf(':')
    if (separator <= 0) return null
    return line.substring(0, separator).trim() to line.substring(separator + 1).trim()
  }

  /**
   * VESC `mc_fault_code` values, keyed by the firmware's own printed name.
   *
   * This is a **different code space** from the Refloat fault codes carried by live `ALLDATA`
   * frames: the controller register holds motor-controller faults, Refloat reports its own balance
   * faults. Nothing here may be compared numerically with a live occurrence's code.
   *
   * @parity /modules/vescape-core/ios/faults/VescFaultRegister.swift `vescFaultCodeForName`
   * @parity /modules/vescape-core/src/modules/board/lib/vescFaults.ts `VESC_FAULT_TITLES`
   */
  private val CODES_BY_NAME: Map<String, Int> = mapOf(
    "NONE" to 0,
    "OVER_VOLTAGE" to 1,
    "UNDER_VOLTAGE" to 2,
    "DRV" to 3,
    "ABS_OVER_CURRENT" to 4,
    "OVER_TEMP_FET" to 5,
    "OVER_TEMP_MOTOR" to 6,
    "GATE_DRIVER_OVER_VOLTAGE" to 7,
    "GATE_DRIVER_UNDER_VOLTAGE" to 8,
    "MCU_UNDER_VOLTAGE" to 9,
    "BOOTING_FROM_WATCHDOG_RESET" to 10,
    "ENCODER_SPI" to 11,
    "ENCODER_SINCOS_BELOW_MIN_AMPLITUDE" to 12,
    "ENCODER_SINCOS_ABOVE_MAX_AMPLITUDE" to 13,
    "FLASH_CORRUPTION" to 14,
    "HIGH_OFFSET_CURRENT_SENSOR_1" to 15,
    "HIGH_OFFSET_CURRENT_SENSOR_2" to 16,
    "HIGH_OFFSET_CURRENT_SENSOR_3" to 17,
    "UNBALANCED_CURRENTS" to 18,
    "BRK" to 19,
    "RESOLVER_LOT" to 20,
    "RESOLVER_DOS" to 21,
    "RESOLVER_LOS" to 22,
    "FLASH_CORRUPTION_APP_CFG" to 23,
    "FLASH_CORRUPTION_MC_CFG" to 24,
    "ENCODER_NO_MAGNET" to 25,
    "ENCODER_MAGNET_TOO_STRONG" to 26,
    "PHASE_FILTER" to 27,
    "ENCODER_FAULT" to 28,
    "LV_OUTPUT_FAULT" to 29,
  )

  /** Resolves a printed fault name to its `mc_fault_code`, or null for a name this build lacks. */
  fun faultCodeForName(name: String): Int? =
    CODES_BY_NAME[name.trim().removePrefix("FAULT_CODE_").uppercase()]
}

/** Serialize parsed entries for the snapshot row. Null (unparsed) round-trips as null. */
internal fun encodeRegisterEntries(entries: List<VescFaultRegisterEntry>?): String? {
  if (entries == null) return null
  val array = JSONArray()
  for (entry in entries) array.put(entry.toJson())
  return array.toString()
}

/** Inverse of [encodeRegisterEntries]. Malformed JSON decodes to null (treated as unparsed). */
internal fun decodeRegisterEntries(json: String?): List<VescFaultRegisterEntry>? {
  if (json == null) return null
  return try {
    val array = JSONArray(json)
    (0 until array.length()).map { VescFaultRegisterEntry.fromJson(array.getJSONObject(it)) }
  } catch (_: Throwable) {
    null
  }
}
