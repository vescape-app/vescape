package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import java.nio.file.Files
import java.nio.file.Path
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.fail
import org.junit.Test

/**
 * Checks the database Room builds against the neutral schema both platforms must produce.
 * @parity /modules/vescape-core/persistence-macos/DatabaseSchemaDump.swift
 */
class DatabaseSchemaHostTest {
  @Test fun freshDatabaseMatchesTheSharedSchema() {
    val path = Files.createTempFile("vescape-schema-fresh-", ".db").also(Files::delete)
    val database = Room.databaseBuilder<TelemetryRoomDatabase>(path.toString())
      .setDriver(BundledSQLiteDriver())
      .build()
    try {
      runBlocking { database.telemetryDao().getAppSetting("schema-open") }
    } finally {
      database.close()
    }
    assertMatchesSharedSchema("fresh", path)
    Files.deleteIfExists(path)
  }
}

/** Fails with a per-table summary, and writes the full dump under `build/`, when [path] differs from the neutral schema. */
internal fun assertMatchesSharedSchema(label: String, path: Path) {
  val schemaFile = Path.of("../schema/database.json")
  val actual = BundledSQLiteDriver().open(path.toString()).use(::dumpDatabaseSchema)
  val expected = JSONObject(Files.readString(schemaFile))
  if (expected.similar(actual)) return
  val written = Path.of("build/database-schema.android-$label.json")
  Files.createDirectories(written.parent)
  Files.writeString(written, actual.toString(2) + "\n")
  fail("Android $label schema differs from ${schemaFile.normalize()}:\n" + describeDifferences(expected, actual) + "\nFull dump: ${written.toAbsolutePath()}")
}

private val internalTables = setOf("room_master_table", "android_metadata", "grdb_migrations")

/** Tables, columns, indexes, and foreign keys in a form that does not depend on which platform built them. */
internal fun dumpDatabaseSchema(db: SQLiteConnection): JSONObject {
  fun rows(sql: String): List<Map<String, Any?>> = db.prepare(sql).use { statement ->
    buildList {
      while (statement.step()) {
        add((0 until statement.getColumnCount()).associate { index ->
          statement.getColumnName(index) to if (statement.isNull(index)) null else statement.getText(index)
        })
      }
    }
  }
  val tables = JSONObject()
  val tableNames = rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map { it["name"] as String }
    .filterNot(internalTables::contains)
  for (table in tableNames) {
    val columns = JSONObject()
    for (column in rows("PRAGMA table_info(`$table`)")) {
      columns.put(column["name"] as String, JSONObject().apply {
        put("type", (column["type"] as String).uppercase())
        put("notNull", column["notnull"] == "1")
        put("default", column["dflt_value"] ?: JSONObject.NULL)
        put("primaryKey", (column["pk"] as String).toInt())
      })
    }
    val indexes = JSONObject()
    for (index in rows("PRAGMA index_list(`$table`)")) {
      if (index["origin"] == "pk") continue
      val name = index["name"] as String
      val indexColumns = rows("PRAGMA index_info(`$name`)").sortedBy { (it["seqno"] as String).toInt() }.map { it["name"] }
      val sql = rows("SELECT sql FROM sqlite_master WHERE type='index' AND name='$name'").singleOrNull()?.get("sql") as String?
      // Constraint indexes get generated names, so key them by what they cover instead.
      val key = if (index["origin"] == "c") name else "unique(${indexColumns.joinToString(",")})"
      indexes.put(key, JSONObject().apply {
        put("columns", JSONArray(indexColumns))
        put("unique", index["unique"] == "1")
        put("where", sql?.let(::partialIndexPredicate) ?: JSONObject.NULL)
      })
    }
    val foreignKeys = JSONArray()
    rows("PRAGMA foreign_key_list(`$table`)")
      .map { "${it["from"]} -> ${it["table"]}.${it["to"]} on delete ${it["on_delete"]} on update ${it["on_update"]}" }
      .sorted()
      .forEach(foreignKeys::put)
    tables.put(table, JSONObject().apply {
      put("columns", columns)
      put("indexes", indexes)
      put("foreignKeys", foreignKeys)
    })
  }
  return JSONObject().put("tables", tables)
}

private fun partialIndexPredicate(sql: String): String? {
  val at = Regex("\\bWHERE\\b", RegexOption.IGNORE_CASE).find(sql) ?: return null
  return sql.substring(at.range.last + 1).replace(Regex("\\s+"), " ").replace("`", "").replace("\"", "").trim()
}

private fun describeDifferences(expected: JSONObject, actual: JSONObject): String {
  val want = expected.getJSONObject("tables")
  val have = actual.getJSONObject("tables")
  val lines = mutableListOf<String>()
  for (table in (want.keySet() + have.keySet()).sorted()) {
    when {
      !have.has(table) -> lines += "  missing table $table"
      !want.has(table) -> lines += "  unexpected table $table"
      else -> {
        for (part in listOf("columns", "indexes")) {
          val w = want.getJSONObject(table).getJSONObject(part)
          val h = have.getJSONObject(table).getJSONObject(part)
          for (name in (w.keySet() + h.keySet()).sorted()) {
            val expectedValue = w.opt(name)
            val actualValue = h.opt(name)
            if (expectedValue is JSONObject && expectedValue.similar(actualValue)) continue
            lines += "  $table.$part.$name: expected ${expectedValue ?: "nothing"}, got ${actualValue ?: "nothing"}"
          }
        }
        val w = want.getJSONObject(table).getJSONArray("foreignKeys")
        val h = have.getJSONObject(table).getJSONArray("foreignKeys")
        if (!w.similar(h)) lines += "  $table.foreignKeys: expected $w, got $h"
      }
    }
  }
  return lines.joinToString("\n")
}
