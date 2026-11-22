package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.database.TELEMETRY_FLAG_KEYFRAME
import java.io.ByteArrayOutputStream
import java.util.zip.DataFormatException
import java.util.zip.Deflater
import java.util.zip.Inflater

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryChunkCodec.swift `TelemetrySample`
 */
internal data class TelemetrySample(
  val capturedAtMs: Long,
  val elapsedRealtimeMs: Long,
  val canId: Int?,
  val flags: Int,
  val values: List<Long?>,
)

internal const val TELEMETRY_CHUNK_VALUE_COLUMNS = 17

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryChunkCodec.swift `reconstructTelemetryValues`
 */
internal fun reconstructTelemetryValues(values: Array<Long?>, flags: Int, changedMask1: Int, row: Array<Long?>) {
  val keyframe = flags and TELEMETRY_FLAG_KEYFRAME != 0
  if (keyframe) values.fill(null)
  for (i in values.indices) if (keyframe || changedMask1 and (1 shl i) != 0) values[i] = row[i]
}

internal class TelemetryChunkFormatException(message: String) : Exception(message)

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryChunkCodec.swift `TelemetryChunkCodec`
 */
internal object TelemetryChunkCodec {
  const val VERSION = 1
  const val MAX_SAMPLES = 65_536
  private const val DEFLATE_LEVEL = 6
  private const val MAX_BODY_BYTES_PER_SAMPLE = 21 * 10 + 3

  private val VALUE_IS_LONG = BooleanArray(TELEMETRY_CHUNK_VALUE_COLUMNS) { it == 14 }

  fun encode(samples: List<TelemetrySample>): ByteArray {
    if (samples.size > MAX_SAMPLES) throw TelemetryChunkFormatException("too many samples: ${samples.size}")
    val base = samples.firstOrNull()?.capturedAtMs ?: 0L
    val body = ByteArrayOutputStream()
    writeColumn(body, base, samples.map { it.capturedAtMs })
    writeColumn(body, 0L, samples.map { it.elapsedRealtimeMs })
    writeColumn(body, 0L, samples.map { it.flags.toLong() })
    writeNullableColumn(body, samples.map { it.canId?.toLong() })
    for (column in 0 until TELEMETRY_CHUNK_VALUE_COLUMNS) {
      val values = samples.map {
        require(it.values.size == TELEMETRY_CHUNK_VALUE_COLUMNS) { "sample needs $TELEMETRY_CHUNK_VALUE_COLUMNS values" }
        it.values[column]
      }
      if (!VALUE_IS_LONG[column]) values.forEach { v ->
        if (v != null && v.toInt().toLong() != v) throw TelemetryChunkFormatException("column $column overflows 32 bits")
      }
      writeNullableColumn(body, values)
    }
    val out = ByteArrayOutputStream()
    out.write(VERSION)
    writeVarint(out, samples.size.toLong())
    writeVarint(out, zigzag(base))
    val deflater = Deflater(DEFLATE_LEVEL, true)
    try {
      deflater.setInput(body.toByteArray())
      deflater.finish()
      val buffer = ByteArray(8192)
      while (!deflater.finished()) out.write(buffer, 0, deflater.deflate(buffer))
    } finally {
      deflater.end()
    }
    return out.toByteArray()
  }

  fun decode(blob: ByteArray): List<TelemetrySample> {
    val header = Reader(blob, 0, blob.size)
    if (header.atEnd()) throw TelemetryChunkFormatException("empty blob")
    val version = header.byte()
    if (version != VERSION) throw TelemetryChunkFormatException("unknown version $version")
    val countRaw = header.varint()
    if (countRaw < 0 || countRaw > MAX_SAMPLES) throw TelemetryChunkFormatException("bad sample count $countRaw")
    val count = countRaw.toInt()
    val base = unzigzag(header.varint())
    val body = inflate(blob, header.position, count.toLong() * MAX_BODY_BYTES_PER_SAMPLE + 16)
    val r = Reader(body, 0, body.size)
    val captured = readColumn(r, count, base)
    val elapsed = readColumn(r, count, 0L)
    val flags = readColumn(r, count, 0L).map { narrow(it) }
    val canIds = readNullableColumn(r, count).map { it?.let(::narrow) }
    val columns = (0 until TELEMETRY_CHUNK_VALUE_COLUMNS).map { column ->
      readNullableColumn(r, count).also { values ->
        if (!VALUE_IS_LONG[column]) values.forEach { if (it != null) narrow(it) }
      }
    }
    if (!r.atEnd()) throw TelemetryChunkFormatException("trailing body bytes")
    return List(count) { i ->
      TelemetrySample(captured[i], elapsed[i], canIds[i], flags[i], columns.map { it[i] })
    }
  }

  private fun inflate(blob: ByteArray, offset: Int, maxBytes: Long): ByteArray {
    val inflater = Inflater(true)
    try {
      inflater.setInput(blob, offset, blob.size - offset)
      val out = ByteArrayOutputStream()
      val buffer = ByteArray(8192)
      while (!inflater.finished()) {
        val n = try { inflater.inflate(buffer) } catch (e: DataFormatException) {
          throw TelemetryChunkFormatException("corrupt deflate stream: ${e.message}")
        }
        if (n == 0 && !inflater.finished() && (inflater.needsInput() || inflater.needsDictionary())) {
          throw TelemetryChunkFormatException("truncated deflate stream")
        }
        out.write(buffer, 0, n)
        if (out.size() > maxBytes) throw TelemetryChunkFormatException("body exceeds bound")
      }
      return out.toByteArray()
    } finally {
      inflater.end()
    }
  }

  private fun writeColumn(out: ByteArrayOutputStream, start: Long, values: List<Long>) {
    var previous = start
    for (v in values) { writeVarint(out, zigzag(v - previous)); previous = v }
  }

  private fun writeNullableColumn(out: ByteArrayOutputStream, values: List<Long?>) {
    val bitmap = ByteArray((values.size + 7) / 8)
    values.forEachIndexed { i, v -> if (v != null) bitmap[i / 8] = (bitmap[i / 8].toInt() or (1 shl (i % 8))).toByte() }
    out.write(bitmap)
    writeColumn(out, 0L, values.filterNotNull())
  }

  private fun readColumn(r: Reader, count: Int, start: Long): List<Long> {
    var previous = start
    return List(count) { (previous + unzigzag(r.varint())).also { previous = it } }
  }

  private fun readNullableColumn(r: Reader, count: Int): List<Long?> {
    val bitmapStart = r.position
    r.skip((count + 7) / 8)
    var previous = 0L
    return List(count) { i ->
      if (r.bytes[bitmapStart + i / 8].toInt() and (1 shl (i % 8)) == 0) null
      else (previous + unzigzag(r.varint())).also { previous = it }
    }
  }

  private fun narrow(value: Long): Int {
    if (value.toInt().toLong() != value) throw TelemetryChunkFormatException("value overflows 32 bits")
    return value.toInt()
  }

  private fun zigzag(v: Long): Long = (v shl 1) xor (v shr 63)
  private fun unzigzag(v: Long): Long = (v ushr 1) xor -(v and 1)

  private fun writeVarint(out: ByteArrayOutputStream, value: Long) {
    var v = value
    while (v and 0x7FL.inv() != 0L) { out.write(((v and 0x7F) or 0x80).toInt()); v = v ushr 7 }
    out.write(v.toInt())
  }

  private class Reader(val bytes: ByteArray, var position: Int, private val end: Int) {
    fun atEnd() = position >= end
    fun byte(): Int {
      if (position >= end) throw TelemetryChunkFormatException("truncated")
      return bytes[position++].toInt() and 0xFF
    }
    fun skip(n: Int) {
      if (end - position < n) throw TelemetryChunkFormatException("truncated")
      position += n
    }
    fun varint(): Long {
      var result = 0L
      for (i in 0 until 10) {
        val b = byte()
        if (i == 9 && b > 1) throw TelemetryChunkFormatException("varint overflow")
        result = result or ((b and 0x7F).toLong() shl (7 * i))
        if (b and 0x80 == 0) return result
      }
      throw TelemetryChunkFormatException("varint overflow")
    }
  }
}
