package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.database.TELEMETRY_FLAG_KEYFRAME
import expo.modules.vescapecore.database.TelemetryChunkEntity
import expo.modules.vescapecore.database.TelemetryChunkHeader
import expo.modules.vescapecore.database.TelemetryFrameEntity
import expo.modules.vescapecore.database.VescapeDao

private const val ALL_VALUE_BITS = (1 shl TELEMETRY_CHUNK_VALUE_COLUMNS) - 1

internal const val TELEMETRY_SEAL_GRACE_MS = 10_000L

data class TelemetryMinuteKey(val boardId: String?, val minuteStartMs: Long)

internal class TelemetrySealMismatch(boardId: String?, minuteStartMs: Long) :
  Exception("Telemetry Chunk verification failed for ${boardId ?: "unowned"} at $minuteStartMs")

internal fun telemetryMinuteStart(atMs: Long) = Math.floorDiv(atMs, TELEMETRY_BUCKET_SIZE_MS) * TELEMETRY_BUCKET_SIZE_MS

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryChunkStore.swift `chunkSampleOrdinal`
 */
internal fun chunkSampleOrdinal(chunkId: Long, index: Int): Long =
  -(chunkId * TelemetryChunkCodec.MAX_SAMPLES + (TelemetryChunkCodec.MAX_SAMPLES - 1 - index))

private fun TelemetrySample.toFrame(id: Long, boardId: String?): TelemetryFrameEntity {
  fun int(i: Int) = values[i]?.toInt()
  return TelemetryFrameEntity(
    id = id, capturedAtMs = capturedAtMs, elapsedRealtimeMs = elapsedRealtimeMs, boardId = boardId,
    canId = canId, flags = flags or TELEMETRY_FLAG_KEYFRAME, changedMask1 = ALL_VALUE_BITS, changedMask2 = 0,
    speedCentiKmh = int(0), batteryVoltageMv = int(1), motorCurrentMa = int(2), batteryCurrentMa = int(3),
    dutyPermille = int(4), pitchCentiDeg = int(5), rollCentiDeg = int(6), balancePitchCentiDeg = int(7),
    balanceCurrentMa = int(8), erpm = int(9), state = int(10), switchState = int(11), adc1Milli = int(12),
    adc2Milli = int(13), odometerCm = values[14], tempMosfetDeciC = int(15), tempMotorDeciC = int(16),
  )
}

private fun TelemetryFrameEntity.storedValues(): Array<Long?> = arrayOf(
  speedCentiKmh?.toLong(), batteryVoltageMv?.toLong(), motorCurrentMa?.toLong(), batteryCurrentMa?.toLong(),
  dutyPermille?.toLong(), pitchCentiDeg?.toLong(), rollCentiDeg?.toLong(), balancePitchCentiDeg?.toLong(),
  balanceCurrentMa?.toLong(), erpm?.toLong(), state?.toLong(), switchState?.toLong(), adc1Milli?.toLong(),
  adc2Milli?.toLong(), odometerCm, tempMosfetDeciC?.toLong(), tempMotorDeciC?.toLong(),
)

private class StreamItem(val frame: TelemetryFrameEntity, val sample: TelemetrySample?)

private val streamOrder = compareBy<StreamItem>({ it.frame.capturedAtMs }, { it.frame.id })

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryChunkStore.swift `telemetryStream`
 */
private suspend fun VescapeDao.telemetryStream(
  fromMs: Long, toMs: Long, boardId: String?, allBoards: Boolean, afterMs: Long, afterId: Long, limit: Int,
): List<StreamItem> {
  val items = getBufferFramesPage(fromMs, toMs, boardId, allBoards, afterMs, afterId, limit)
    .mapTo(ArrayList()) { StreamItem(it, null) }
  var fromChunks = 0
  var lastMinute: Long? = null
  for (header in getTelemetryChunkHeaders(maxOf(fromMs, afterMs), toMs, boardId, allBoards)) {
    if (fromChunks >= limit && header.minuteStartMs != lastMinute) break
    lastMinute = header.minuteStartMs
    TelemetryChunkCodec.decode(getTelemetryChunkPayload(header.id)).forEachIndexed { index, sample ->
      val t = sample.capturedAtMs
      val id = chunkSampleOrdinal(header.id, index)
      if (t < fromMs || t > toMs || t < afterMs || (t == afterMs && id <= afterId)) return@forEachIndexed
      items += StreamItem(sample.toFrame(id, header.boardId), sample)
      fromChunks++
    }
  }
  items.sortWith(streamOrder)
  return if (items.size > limit) items.subList(0, limit) else items
}

internal suspend fun VescapeDao.readTelemetryFramesImpl(
  fromMs: Long, toMs: Long, boardId: String?, allBoards: Boolean, afterMs: Long, afterId: Long, limit: Int,
): List<TelemetryFrameEntity> = telemetryStream(fromMs, toMs, boardId, allBoards, afterMs, afterId, limit).map { it.frame }

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryChunkStore.swift `telemetryAnchorMs`
 */
internal suspend fun VescapeDao.telemetryAnchorMs(beforeMs: Long, boardId: String?, allBoards: Boolean): Long? =
  listOfNotNull(latestBufferKeyframeBefore(beforeMs, boardId, allBoards), latestChunkStartBefore(beforeMs, boardId, allBoards))
    .maxOrNull()

private suspend fun VescapeDao.chunkSamples(header: TelemetryChunkHeader) =
  TelemetryChunkCodec.decode(getTelemetryChunkPayload(header.id))

/** @parity /modules/vescape-core/ios/telemetry/TelemetryChunkStore.swift `firstTelemetrySampleAtOrAfter` */
internal suspend fun VescapeDao.firstTelemetrySampleAtOrAfter(fromMs: Long): Long? {
  val minute = telemetryMinuteStart(fromMs)
  val straddling = getTelemetryChunkHeaders(fromMs, minute + TELEMETRY_BUCKET_SIZE_MS - 1, null, true)
    .mapNotNull { header -> chunkSamples(header).firstOrNull { it.capturedAtMs >= fromMs }?.capturedAtMs }
  return (straddling + listOfNotNull(firstBufferFrameAtOrAfter(fromMs), firstChunkStartAfterMinute(minute))).minOrNull()
}

/** @parity /modules/vescape-core/ios/telemetry/TelemetryChunkStore.swift `telemetrySampleExists` */
internal suspend fun VescapeDao.telemetrySampleExists(atMs: Long, boardId: String?): Boolean =
  bufferFrameExists(atMs, boardId) ||
    getTelemetryChunkHeaders(atMs, atMs, boardId, false).any { header ->
      chunkSamples(header).any { it.capturedAtMs == atMs }
    }

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryChunkStore.swift `trimTelemetryChunks`
 */
internal suspend fun VescapeDao.trimTelemetryChunks(fromMs: Long, toMs: Long, boardId: String?, allBoards: Boolean): Int {
  var removed = 0
  for (header in getTelemetryChunkHeaders(fromMs, toMs, boardId, allBoards)) {
    if (header.firstAtMs >= fromMs && header.lastAtMs <= toMs) {
      deleteTelemetryChunk(header.id)
      removed += header.sampleCount
      continue
    }
    val samples = chunkSamples(header)
    val kept = samples.filter { it.capturedAtMs < fromMs || it.capturedAtMs > toMs }
    removed += samples.size - kept.size
    when {
      kept.isEmpty() -> deleteTelemetryChunk(header.id)
      kept.size != samples.size -> updateTelemetryChunk(header.id, TelemetryChunkCodec.VERSION, kept.size,
        kept.first().capturedAtMs, kept.last().capturedAtMs, TelemetryChunkCodec.encode(kept))
    }
  }
  return removed
}

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryChunkStore.swift `sealTelemetryMinute`
 */
internal suspend fun VescapeDao.sealTelemetryMinuteImpl(boardId: String?, minuteStartMs: Long): Int {
  val minuteEnd = minuteStartMs + TELEMETRY_BUCKET_SIZE_MS - 1
  val start = telemetryAnchorMs(minuteStartMs, boardId, false) ?: minuteStartMs
  val values = arrayOfNulls<Long>(TELEMETRY_CHUNK_VALUE_COLUMNS)
  val samples = mutableListOf<TelemetrySample>()
  val sealed = mutableListOf<Long>()
  for (item in telemetryStream(start, minuteEnd, boardId, false, Long.MIN_VALUE, Long.MIN_VALUE, Int.MAX_VALUE)) {
    val frame = item.frame
    val sample = item.sample ?: run {
      reconstructTelemetryValues(values, frame.flags, frame.changedMask1, frame.storedValues())
      TelemetrySample(frame.capturedAtMs, frame.elapsedRealtimeMs, frame.canId, frame.flags, values.toList())
    }
    if (item.sample != null) sample.values.forEachIndexed { i, v -> values[i] = v }
    if (frame.capturedAtMs < minuteStartMs) continue
    samples += sample
    if (item.sample == null) sealed += frame.id
  }
  if (sealed.isEmpty()) return 0
  val payload = TelemetryChunkCodec.encode(samples)
  if (TelemetryChunkCodec.decode(payload) != samples) throw TelemetrySealMismatch(boardId, minuteStartMs)
  val boardKey = boardId?.let { resolveBoardKey(it) }
  val existing = getTelemetryChunkId(boardKey, minuteStartMs)
  if (existing == null) {
    insertTelemetryChunk(TelemetryChunkEntity(boardKey = boardKey, minuteStartMs = minuteStartMs,
      codecVersion = TelemetryChunkCodec.VERSION, sampleCount = samples.size, firstAtMs = samples.first().capturedAtMs,
      lastAtMs = samples.last().capturedAtMs, payload = payload))
  } else {
    updateTelemetryChunk(existing, TelemetryChunkCodec.VERSION, samples.size, samples.first().capturedAtMs,
      samples.last().capturedAtMs, payload)
  }
  sealed.chunked(500).forEach { deleteFramesByIds(it) }
  return sealed.size
}

class TelemetrySealBatch(val sealedMinutes: Int, val failures: List<Pair<TelemetryMinuteKey, Exception>>)

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryChunkStore.swift `drainTelemetryMinutes`
 */
internal suspend fun VescapeDao.drainTelemetryMinutesImpl(keys: List<TelemetryMinuteKey>, nowMs: Long, gapMs: Long): TelemetrySealBatch? {
  if (activeRideStartMs(nowMs, gapMs) != null) return null
  var sealedMinutes = 0
  val failures = mutableListOf<Pair<TelemetryMinuteKey, Exception>>()
  for (key in keys) {
    try {
      if (sealTelemetryMinuteImpl(key.boardId, key.minuteStartMs) > 0) sealedMinutes++
    } catch (failure: TelemetrySealMismatch) {
      failures += key to failure
    } catch (failure: TelemetryChunkFormatException) {
      failures += key to failure
    }
  }
  return TelemetrySealBatch(sealedMinutes, failures)
}

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryChunkStore.swift `telemetryDrainCutoffMs`
 */
internal fun telemetryDrainCutoffMs(nowMs: Long) = telemetryMinuteStart(nowMs - TELEMETRY_SEAL_GRACE_MS)

/** @parity /modules/vescape-core/ios/telemetry/TelemetryChunkStore.swift `TELEMETRY_DRAIN_BATCH_MINUTES` */
internal const val TELEMETRY_DRAIN_BATCH_MINUTES = 30

internal data class TelemetryDrainResult(val minutes: Int, val sealedMinutes: Int, val failures: Int, val yielded: Boolean)

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryChunkStore.swift `drainTelemetryBuffer`
 */
internal suspend fun drainTelemetryBuffer(
  scope: MaintenanceJobScope,
  gapMs: Long,
  batch: Int = TELEMETRY_DRAIN_BATCH_MINUTES,
  onFailure: (TelemetryMinuteKey, Exception) -> Unit,
): TelemetryDrainResult {
  val keys = scope.chunk { it.closedTelemetryMinutes(telemetryDrainCutoffMs(scope.nowMs())) }
  var sealedMinutes = 0
  var failures = 0
  var done = 0
  for (slice in keys.chunked(batch)) {
    val result = scope.chunk { it.drainTelemetryMinutes(slice, scope.nowMs(), gapMs) } ?: return TelemetryDrainResult(keys.size, sealedMinutes, failures, yielded = true)
    sealedMinutes += result.sealedMinutes
    failures += result.failures.size
    result.failures.forEach { (key, error) -> onFailure(key, error) }
    done += slice.size
    scope.progress(done, keys.size)
    scope.committed()
  }
  return TelemetryDrainResult(keys.size, sealedMinutes, failures, yielded = false)
}
