package expo.modules.vescapecore.sync

/**
 * A row the server could never store. Permanent for this phone: retrying the same bytes cannot make
 * it succeed, so the engine pauses with the row retained rather than skipping it.
 *
 * The message names the table and the field only — never the value, which may be a coordinate, a
 * Rider's text or a token.
 *
 * @parity /modules/vescape-core/ios/sync/SyncJson.swift `SyncProtocolError`
 */
class SyncProtocolException(val table: SyncTable, val field: String, val problem: String) :
  IllegalStateException("${table.wire}.$field $problem")

/**
 * A compact JSON object writer that validates as it writes.
 *
 * Deliberately not `org.json`: this has to produce the exact bytes measured against the wire byte
 * cap, in a stable field order, and run in plain JVM tests where the platform's JSON is a stub. The
 * bounds it enforces are the server's own (`vescape-server` `src/sync/protocol.ts`), applied before
 * transport so a wedged batch is impossible rather than merely unlikely.
 *
 * Nullable columns are written as explicit nulls: "cleared" and "not mentioned" are different
 * intents, and a missing key cannot express the first.
 *
 * @parity /modules/vescape-core/ios/sync/SyncJson.swift `SyncRowWriter`
 * @parity /modules/vescape-server/src/sync/protocol.ts
 */
class SyncRowWriter(private val table: SyncTable) {
  private val out = StringBuilder("{")

  fun build(): String = out.append('}').toString()

  /** An identifier the phone chose: a Board id, a settings key, an event name. Never empty. */
  fun keyText(field: String, value: String): SyncRowWriter = apply {
    if (value.isEmpty()) fail(field, "must not be empty")
    boundedText(field, value)
  }

  fun nullableKeyText(field: String, value: String?): SyncRowWriter = apply {
    if (value == null) raw(field, "null") else keyText(field, value)
  }

  /**
   * A key column the phone derives rather than names, so it may legitimately be empty — a sanitizer
   * writes `""` as the device id of a sample captured with no Board connected.
   */
  fun derivedKeyText(field: String, value: String?): SyncRowWriter = apply {
    if (value == null) raw(field, "null") else boundedText(field, value)
  }

  /** Text the server stores opaquely and hands back unchanged. Uncapped, like the server's. */
  fun text(field: String, value: String?): SyncRowWriter = apply {
    if (value == null) raw(field, "null") else raw(field, quote(value))
  }

  fun bool(field: String, value: Boolean): SyncRowWriter = raw(field, if (value) "true" else "false")

  /** Epoch ms, or a duration in ms: non-negative and inside the JSON-safe integer range. */
  fun timestamp(field: String, value: Long?): SyncRowWriter = bounded(field, value, 0, SYNC_SAFE_INT_MAX)

  fun int32(field: String, value: Int?): SyncRowWriter =
    bounded(field, value?.toLong(), SYNC_INT32_MIN, SYNC_INT32_MAX)

  fun count(field: String, value: Int?): SyncRowWriter =
    bounded(field, value?.toLong(), 0, SYNC_INT32_MAX)

  /** A 64-bit column that is not a timestamp — an odometer reading. */
  fun int64(field: String, value: Long?): SyncRowWriter =
    bounded(field, value, -SYNC_SAFE_INT_MAX, SYNC_SAFE_INT_MAX)

  /** A real number. Neither infinity nor NaN is expressible in JSON. */
  fun number(field: String, value: Double?): SyncRowWriter = apply {
    if (value == null) {
      raw(field, "null")
      return@apply
    }
    if (!value.isFinite()) fail(field, "must be finite")
    val whole = value.toLong()
    raw(field, if (value == whole.toDouble()) whole.toString() else value.toString())
  }

  /**
   * A measurement the firmware reported, where non-finite means the reading is unusable rather
   * than that the row is malformed.
   *
   * [number] refuses infinity and NaN, which is right for a value a Rider authored — one there is
   * a bug worth stopping for. A decoded Board sample is the opposite case: the app did not choose
   * the value, it received it, and one bad float would pause every table's backup on a permanent
   * protocol error that no retry can clear. These columns are all nullable precisely because a
   * field the firmware did not send is absent, so an unusable one is absent too.
   *
   * @parity /modules/vescape-core/ios/sync/SyncJson.swift `reading`
   */
  fun reading(field: String, value: Double?): SyncRowWriter =
    number(field, if (value != null && value.isFinite()) value else null)

  private fun bounded(field: String, value: Long?, min: Long, max: Long): SyncRowWriter = apply {
    if (value == null) {
      raw(field, "null")
      return@apply
    }
    if (value < min || value > max) fail(field, "is out of bounds")
    raw(field, value.toString())
  }

  private fun boundedText(field: String, value: String) {
    if (value.length > MAX_SYNC_KEY_LENGTH) fail(field, "exceeds $MAX_SYNC_KEY_LENGTH characters")
    raw(field, quote(value))
  }

  private fun raw(field: String, encoded: String): SyncRowWriter = apply {
    if (out.length > 1) out.append(',')
    out.append(quote(field)).append(':').append(encoded)
  }

  private fun fail(field: String, problem: String): Nothing =
    throw SyncProtocolException(table, field, problem)

  private fun quote(value: String): String {
    val quoted = StringBuilder(value.length + 2).append('"')
    for (char in value) {
      when {
        char == '"' -> quoted.append("\\\"")
        char == '\\' -> quoted.append("\\\\")
        char == '\n' -> quoted.append("\\n")
        char == '\r' -> quoted.append("\\r")
        char == '\t' -> quoted.append("\\t")
        char < ' ' -> quoted.append("\\u%04x".format(char.code))
        else -> quoted.append(char)
      }
    }
    return quoted.append('"').toString()
  }
}
