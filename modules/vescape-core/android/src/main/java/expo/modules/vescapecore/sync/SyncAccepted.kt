package expo.modules.vescapecore.sync

/**
 * The `200` body: what the server took, per table.
 *
 * Validated exactly before any cursor moves. A missing table, an extra table, a non-integer count or
 * a count that differs from what was submitted is a protocol failure — the server applies a batch
 * whole, so anything else means the two sides disagree about what was stored, and advancing a cursor
 * on that disagreement is unrecoverable.
 *
 * Parsed here rather than with the platform JSON so the rule runs in plain unit tests and behaves
 * identically on both platforms.
 *
 * @parity /modules/vescape-core/ios/sync/SyncAccepted.swift
 */
object SyncAccepted {
  /** Accepted counts by table, or null when the body is not exactly the expected response. */
  fun parse(body: String): Map<SyncTable, Int>? {
    val counts = LinkedHashMap<SyncTable, Int>()
    val scanner = Scanner(body)
    if (!scanner.expect('{') || !scanner.expectKey("accepted") || !scanner.expect('{')) return null
    if (scanner.peek() != '}') {
      while (true) {
        val name = scanner.string() ?: return null
        val table = SyncTable.entries.firstOrNull { it.wire == name } ?: return null
        if (counts.containsKey(table) || !scanner.expect(':')) return null
        counts[table] = scanner.integer() ?: return null
        if (scanner.expect(',')) continue
        break
      }
    }
    if (!scanner.expect('}') || !scanner.expect('}') || !scanner.atEnd()) return null
    return if (counts.size == SyncTable.entries.size) counts else null
  }

  /** True when the response accounts for exactly the rows submitted, table by table. */
  fun matches(submitted: Map<SyncTable, Int>, accepted: Map<SyncTable, Int>): Boolean =
    SyncTable.entries.all { accepted[it] == (submitted[it] ?: 0) }

  private class Scanner(private val source: String) {
    private var index = 0

    fun atEnd(): Boolean = skipSpace().let { index >= source.length }

    fun peek(): Char? = skipSpace().let { source.getOrNull(index) }

    fun expect(char: Char): Boolean {
      if (peek() != char) return false
      index += 1
      return true
    }

    fun expectKey(name: String): Boolean = string() == name && expect(':')

    fun string(): String? {
      if (!expect('"')) return null
      val end = source.indexOf('"', index)
      // Counts and table names carry no escapes; a body that needs them is not this response.
      if (end < 0) return null
      return source.substring(index, end).also { index = end + 1 }
    }

    fun integer(): Int? {
      skipSpace()
      val start = index
      while (index < source.length && source[index].isDigit()) index += 1
      return if (index == start) null else source.substring(start, index).toIntOrNull()
    }

    private fun skipSpace() {
      while (index < source.length && source[index].isWhitespace()) index += 1
    }
  }
}
