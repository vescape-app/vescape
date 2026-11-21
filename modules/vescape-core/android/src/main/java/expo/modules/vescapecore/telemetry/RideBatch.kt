package expo.modules.vescapecore.telemetry

import java.io.File
import java.io.Writer
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * @parity /modules/vescape-core/ios/telemetry/RideBatch.swift
 * @parity /modules/vescape-core/src/index.ts `RideSelection`
 */
internal object RideBatch {
  data class Item(val fromMs: Long, val toMs: Long, val boardId: String?, val name: String?) {
    companion object {
      fun from(map: Map<*, *>): Item {
        val fromMs = (map["fromMs"] as? Number)?.toLong() ?: error("Missing ride start")
        val toMs = (map["toMs"] as? Number)?.toLong() ?: error("Missing ride end")
        require(fromMs <= toMs) { "Invalid ride range" }
        return Item(fromMs, toMs, map["boardId"] as? String, map["name"] as? String)
      }
    }
  }

  class Cancelled : Exception("Ride export cancelled")

  fun format(value: Any?): RideExport.Format = when (value) {
    "gpx" -> RideExport.Format.GPX
    "csv" -> RideExport.Format.CSV
    "floaty" -> RideExport.Format.FLOATY
    else -> throw IllegalArgumentException("Unknown export format: $value")
  }

  private val stamp = DateTimeFormatter.ofPattern("uuuu-MM-dd_HHmm", Locale.ROOT)
  private val day = DateTimeFormatter.ofPattern("uuuu-MM-dd", Locale.ROOT)

  fun entryNames(items: List<Item>, extension: String, zone: ZoneId): List<String> {
    val used = mutableMapOf<String, Int>()
    return items.map { item ->
      val base = "${stamp.withZone(zone).format(Instant.ofEpochMilli(item.fromMs))}_${slug(item.name)}"
      val n = (used[base] ?: 0) + 1
      used[base] = n
      if (n == 1) "$base.$extension" else "$base-$n.$extension"
    }
  }

  fun zipName(items: List<Item>, zone: ZoneId): String {
    val first = day.withZone(zone).format(Instant.ofEpochMilli(items.minOf { it.fromMs }))
    val last = day.withZone(zone).format(Instant.ofEpochMilli(items.maxOf { it.fromMs }))
    return if (first == last) "vescape-rides-$first.zip" else "vescape-rides-${first}_$last.zip"
  }

  fun slug(name: String?): String =
    (name ?: "").replace(Regex("[^A-Za-z0-9]+"), "-").trim('-').ifEmpty { "ride" }

  suspend fun zip(
    directory: File,
    items: List<Item>,
    format: RideExport.Format,
    zone: ZoneId,
    isCancelled: () -> Boolean,
    onProgress: (done: Int, total: Int) -> Unit,
    writeRide: suspend (Writer, Item) -> Unit,
  ): Map<String, Any> {
    require(items.isNotEmpty()) { "No rides to export" }
    val folder = File(directory, "ride-export-${UUID.randomUUID()}").apply { mkdirs() }
    val file = File(folder, zipName(items, zone))
    try {
      val zip = ZipOutputStream(file.outputStream().buffered())
      zip.bufferedWriter(Charsets.UTF_8).use { writer ->
        val guarded = CancellableWriter(writer, isCancelled)
        entryNames(items, format.extension, zone).forEachIndexed { index, name ->
          if (isCancelled()) throw Cancelled()
          zip.putNextEntry(ZipEntry(name))
          writeRide(guarded, items[index])
          writer.flush()
          zip.closeEntry()
          onProgress(index + 1, items.size)
        }
      }
      return mapOf("uri" to file.toURI().toString(), "mimeType" to "application/zip", "uti" to "public.zip-archive")
    } catch (error: Throwable) {
      folder.deleteRecursively()
      throw error
    }
  }

  private class CancellableWriter(private val out: Writer, private val isCancelled: () -> Boolean) : Writer() {
    override fun write(cbuf: CharArray, off: Int, len: Int) {
      if (isCancelled()) throw Cancelled()
      out.write(cbuf, off, len)
    }
    override fun write(str: String, off: Int, len: Int) {
      if (isCancelled()) throw Cancelled()
      out.write(str, off, len)
    }
    override fun flush() = out.flush()
    override fun close() = Unit
  }
}
