package expo.modules.vescapecore.telemetry

import android.content.Context
import android.os.SystemClock
import android.util.Log
import expo.modules.kotlin.jni.NativeArrayBuffer
import expo.modules.vescapecore.sync.SyncCoordinator
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import org.json.JSONObject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.roundToLong

private const val TAG = "TelemetryStore"
private const val KEYFRAME_INTERVAL_MS = 60_000L
private const val GAP_BOUNDARY_MS = 90_000L
private const val FLUSH_FRAME_COUNT = 25
private const val FLUSH_DELAY_MS = 5_000L
private const val MAX_PENDING_FRAMES = 1_000
private const val DEFAULT_HISTORY_LIMIT = 100
private const val DEFAULT_SAMPLE_LIMIT = 2_000
// Read cap: hard ceiling on samples materialized per range read. Bounds heap +
// bridge cost so a long/garbage session can't OOM the app. At 2 Hz persistence
// this covers ~2 h 46 min of riding before a read truncates. See recordTelemetry.
private const val MAX_SAMPLE_LIMIT = 20_000
/** Bottom history chart overview; full samples remain available for map and chart screen. */
// @parity /modules/vescape-core/ios/telemetry/TelemetryRangePayload.swift `HISTORY_CHART_OVERVIEW_SAMPLES`
private const val HISTORY_CHART_OVERVIEW_SAMPLES = 600
// Write gate: minimum spacing between persisted detail frames (2 Hz), shrinking DB
// growth ~8x. Minute buckets are aggregated from the full-rate stream separately
// (see pendingBucketStates), so avg/energy/peaks stay exact; live display and the
// live series stream are also separate full-rate paths.
private const val MIN_PERSIST_INTERVAL_MS = 500L

/**
 * Float64 lanes per sample in the columnar history payload. Must match the JS decoder.
 *
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `SAMPLE_COLUMN_COUNT`
 * @parity /modules/vescape-core/src/index.ts `SAMPLE_COLUMN_COUNT`
 */
private const val SAMPLE_COLUMN_COUNT = 23

data class TelemetryLocationCapture(
  val latitude: Double,
  val longitude: Double,
  val speedMps: Double?,
  val bearingDeg: Double?,
  val accuracyM: Double?,
  val altitudeM: Double?,
  val timestamp: Long,
  val precise: Boolean,
)

data class TelemetryCapture(
  val capturedAtMs: Long,
  val elapsedRealtimeMs: Long,
  /** Owning Board (`boards.id`) — what every telemetry table is keyed on (ADR 0028). */
  val boardId: String?,
  val canId: Int?,
  val pitch: Double,
  val roll: Double,
  val balancePitch: Double,
  val balanceCurrent: Double,
  val speed: Double,
  val batteryVoltage: Double,
  val motorCurrent: Double,
  val batteryCurrent: Double,
  val erpm: Int,
  val dutyCycle: Double,
  val state: Int,
  val switchState: Int,
  val adc1: Double,
  val adc2: Double,
  val odometer: Double?,
  val tempMosfet: Double?,
  val tempMotor: Double?,
  val avgLatency: Int?,
  val location: TelemetryLocationCapture?,
)

// @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift
class TelemetryRepository private constructor(context: Context) {
  private val appContext = context.applicationContext
  private val db = TelemetryDatabase.get(context)
  private val dao = db.telemetryDao()
  private val favoriteMediaStore = FavoriteMediaStore(appContext, dao)
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val lock = Any()
  private val pending = ArrayDeque<PendingFrame>()
  // Full-rate states for bucket aggregation (exact avg / energy / peaks), decoupled
  // from the 2 Hz `pending` detail trace. Every received frame lands here; only a
  // 2 Hz subset is persisted as frames. Flushed and cleared together with `pending`.
  private val pendingBucketStates = ArrayDeque<FullTelemetryState>()
  private val pendingMarkers = ArrayDeque<TelemetryMarkerEntity>()

  private var flushScheduled = false
  private var lastState: FullTelemetryState? = null
  private var lastFrameAtMs: Long? = null
  private var lastHistoryAtMs: Long? = null
  private var lastKeyframeAtMs: Long? = null
  private var forceNextKeyframe = true
  private var droppedPendingFrames = 0L
  private var metricSanitizerConfig = MetricSanitizerConfig()
  @Volatile
  private var enabledPrivacyZones: List<PrivacyZoneEntity> = emptyList()

  fun setMovingSpeedThresholdKmh(value: Double) {
    metricSanitizerConfig = metricSanitizerConfig.copy(
      movingSpeedThresholdCentiKmh = (value * 100.0).roundToInt().coerceAtLeast(0),
    )
  }

  fun setFreeSpinMaxSpeedDeltaKmh(value: Double) {
    metricSanitizerConfig = metricSanitizerConfig.copy(
      freeSpinMaxSpeedDeltaCentiKmh = (value * 100.0).roundToInt().coerceAtLeast(0),
    )
  }

  fun setFreeSpinStationaryBoardCapKmh(value: Double) {
    metricSanitizerConfig = metricSanitizerConfig.copy(
      freeSpinStationaryBoardCapCentiKmh = (value * 100.0).roundToInt().coerceAtLeast(0),
    )
  }

  fun applySettings(settings: AppSettings) {
    metricSanitizerConfig = settings.toMetricSanitizerConfig()
  }

  fun reloadPrivacyZones(zones: List<PrivacyZoneEntity>) {
    enabledPrivacyZones = zones
  }

  fun recordMarker(
    type: String,
    boardId: String?,
    message: String? = null,
    gapMs: Long? = null,
    occurredAtMs: Long = System.currentTimeMillis(),
    elapsedRealtimeMs: Long = SystemClock.elapsedRealtime(),
  ) {
    val marker = TelemetryMarkerEntity(
      occurredAtMs = occurredAtMs,
      elapsedRealtimeMs = elapsedRealtimeMs,
      type = type,
      boardId = boardId,
      message = message,
      gapMs = gapMs,
    )
    synchronized(lock) {
      pendingMarkers.addLast(marker)
      scheduleFlushLocked()
    }
  }

  fun recordDiagnosticEvent(eventName: String, properties: Map<String, Any?> = emptyMap()) {
    val now = System.currentTimeMillis()
    val event = DiagnosticEventEntity(
      occurredAtMs = now,
      elapsedRealtimeMs = SystemClock.elapsedRealtime(),
      eventName = eventName,
      operation = properties["operation"] as? String,
      phase = properties["phase"] as? String,
      boardId = properties["board_id"] as? String,
      message = properties["message"] as? String,
      propertiesJson = JSONObject(sanitizeDiagnosticProperties(properties)).toString(),
    )
    scope.launch {
      try {
        dao.insertDiagnosticEvent(event)
      } catch (e: Exception) {
        Log.w(TAG, "Diagnostic event write failed: ${e.message}")
      }
    }
  }

  fun recordTelemetry(capture: TelemetryCapture) {
    val current = FullTelemetryState.from(capture)
    synchronized(lock) {
      val previous = lastState
      val gapMs = lastHistoryAtMs?.let { capture.capturedAtMs - it }
      val gap = gapMs != null && gapMs > GAP_BOUNDARY_MS
      val keyframe = forceNextKeyframe ||
        previous == null ||
        gap ||
        lastKeyframeAtMs == null ||
        capture.capturedAtMs - (lastKeyframeAtMs ?: 0L) >= KEYFRAME_INTERVAL_MS

      // Every frame feeds bucket aggregation at full rate — avg, energy and peak
      // max(current/duty/speed/temp) stay exact regardless of the persisted rate.
      pendingBucketStates.addLast(current)
      while (pendingBucketStates.size > MAX_PENDING_FRAMES) pendingBucketStates.removeFirst()

      // 2 Hz persistence gate for the stored detail trace only. Keep keyframes
      // (delta-chain anchors / gaps); otherwise keep one frame per
      // MIN_PERSIST_INTERVAL_MS. Gated frames leave lastState/lastHistoryAtMs untouched
      // so the next persisted delta chains against the last persisted state.
      val sinceKept = lastHistoryAtMs?.let { capture.capturedAtMs - it }
      val persist = keyframe || sinceKept == null || sinceKept >= MIN_PERSIST_INTERVAL_MS
      if (persist) {
        pending.addLast(PendingFrame(current.toFrame(previous, keyframe), current))
        if (gap) {
          pendingMarkers.addLast(
            TelemetryMarkerEntity(
              occurredAtMs = capture.capturedAtMs,
              elapsedRealtimeMs = capture.elapsedRealtimeMs,
              type = "gap",
              boardId = capture.boardId,
              message = null,
              gapMs = gapMs,
            ),
          )
        }
        while (pending.size > MAX_PENDING_FRAMES) {
          pending.removeFirst()
          droppedPendingFrames++
          forceNextKeyframe = true
        }
        lastState = current
        lastFrameAtMs = capture.capturedAtMs
        lastHistoryAtMs = capture.capturedAtMs
        if (keyframe) {
          lastKeyframeAtMs = capture.capturedAtMs
          forceNextKeyframe = false
        }
      }

      if (pending.size >= FLUSH_FRAME_COUNT || pendingBucketStates.size >= FLUSH_FRAME_COUNT) {
        flushScheduled = false
        scope.launch { flushNow() }
      } else {
        scheduleFlushLocked()
      }
    }
  }

  fun flushBlocking() {
    runBlocking(Dispatchers.IO) {
      synchronized(lock) {
        forceNextKeyframe = true
      }
      flushNow()
    }
  }

  suspend fun flushPending() = withContext(Dispatchers.IO) {
    synchronized(lock) {
      forceNextKeyframe = true
    }
    flushNow()
  }

  fun shutdownForDatabaseSwap() {
    scope.cancel()
    synchronized(lock) {
      pending.clear()
      pendingBucketStates.clear()
      pendingMarkers.clear()
      flushScheduled = false
      lastState = null
      lastFrameAtMs = null
      lastHistoryAtMs = null
      lastKeyframeAtMs = null
      forceNextKeyframe = true
    }
  }

  suspend fun getHistory(options: Map<String, Any?>): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    val query = HistoryQueryOptions.from(options)
    val buckets = dao.getHistoryBuckets(
      query.fromMs,
      query.toMs,
      query.beforeMs,
      query.boardId,
      query.limit,
    )
    if (buckets.isEmpty()) return@withContext emptyList()
    val markerFrom = buckets.minOf { it.bucketStartMs } - GAP_BOUNDARY_MS
    val markerTo = buckets.maxOf { it.bucketStartMs } + TELEMETRY_BUCKET_SIZE_MS
    val markers = dao.getMarkers(markerFrom, markerTo, query.boardId)
    val boardNames = boardNamesById()
    buckets.map { bucket ->
      val marker = markers.lastOrNull {
        // An all-Boards read leaves the marker query unscoped, so the bucket has to claim its own.
        it.occurredAtMs >= bucket.firstSampleAtMs - 5_000L &&
          it.occurredAtMs <= bucket.firstSampleAtMs + 1_000L &&
          (it.boardId ?: "") == bucket.boardId
      }
      val avgAbsSpeed = if (bucket.sampleCount > 0) {
        bucket.sumAbsSpeedCentiKmh.toDouble() / bucket.sampleCount / 100.0
      } else {
        0.0
      }
      val avgSpeedSampleCount = bucket.movingSpeedSampleCount ?: bucket.sampleCount
      val avgSpeed = if (bucket.movingSpeedSampleCount != null) {
        if (avgSpeedSampleCount > 0) {
          (bucket.sumMovingAbsSpeedCentiKmh ?: 0L).toDouble() / avgSpeedSampleCount / 100.0
        } else {
          0.0
        }
      } else {
        avgAbsSpeed
      }
      val maxGpsSpeedKmh = bucket.maxGpsSpeedCentiMps?.let { it / 100.0 * 3.6 }
      val distanceM = distanceDeltaM(bucket) ?: bucket.gpsDistanceCm.takeIf { it > 0L }?.let { it / 100.0 }
      mapOf(
        "id" to "${bucket.boardId}:${bucket.bucketStartMs}",
        "startAtMs" to bucket.firstSampleAtMs,
        "endAtMs" to bucket.lastSampleAtMs,
        "bucketStartMs" to bucket.bucketStartMs,
        "boardId" to bucket.boardId.ifBlank { null },
        "boardName" to (boardNames[bucket.boardId] ?: UNKNOWN_TELEMETRY_BOARD_NAME),
        "sampleCount" to bucket.sampleCount,
        "gpsPointCount" to bucket.gpsPointCount,
        "preciseGpsPointCount" to bucket.preciseGpsPointCount,
        "maxAbsSpeedKmh" to bucket.maxAbsSpeedCentiKmh / 100.0,
        "maxGpsSpeedKmh" to maxGpsSpeedKmh,
        "avgSpeedKmh" to avgSpeed,
        "avgSpeedSampleCount" to avgSpeedSampleCount,
        "minBatteryVoltage" to bucket.minBatteryVoltageMv?.let { it / 1000.0 },
        "maxMotorCurrent" to bucket.maxMotorCurrentAbsMa / 1000.0,
        "maxBatteryCurrent" to bucket.maxBatteryCurrentAbsMa / 1000.0,
        "maxDuty" to bucket.maxDutyAbsPermille / 1000.0,
        "distanceDeltaM" to distanceM,
        "gpsDistanceM" to bucket.gpsDistanceCm.takeIf { it > 0L }?.let { it / 100.0 },
        "maxTempMosfet" to bucket.maxTempMosfetDeciC?.let { it / 10.0 },
        "maxTempMotor" to bucket.maxTempMotorDeciC?.let { it / 10.0 },
        "batteryUsedWh" to bucket.batteryUsedWhMilli / 1000.0,
        "batteryRegenWh" to bucket.batteryRegenWhMilli / 1000.0,
        "firstLatitude" to bucket.firstLatitudeE7?.let { it / 1e7 },
        "firstLongitude" to bucket.firstLongitudeE7?.let { it / 1e7 },
        "firstMovingAtMs" to bucket.firstMovingAtMs,
        "lastMovingAtMs" to bucket.lastMovingAtMs,
        "boundaryBefore" to (marker?.type ?: "none"),
        "boundaryMessage" to marker?.message,
        "gapBeforeMs" to marker?.gapMs,
      )
    }
  }

  suspend fun getSamples(options: Map<String, Any?>): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    val query = SampleQueryOptions.from(options)
    smoothedSampleMaps(
      getSampleStates(query.fromMs, query.toMs, query.boardId, query.limit),
      batteryConfigByBoard(),
    )
  }

  /**
   * Recomputes the Battery SoC Estimate per sample on read (ADR-0016): IR-compensated % run
   * through a per-device median window. Mirrors how IR compensation is already applied on read;
   * approximate because stored frames are delta-encoded.
   */
  private suspend fun smoothedSampleMaps(
    samples: List<HistoryTelemetryState>,
    configs: Map<String, Map<String, Any?>>,
  ): List<Map<String, Any?>> {
    val windowMs = AppDataRepository.get(appContext).getTypedSettings().socEstimateWindowSeconds * 1000L
    val windows = HashMap<String?, SocMedianWindow>()
    val boardNames = boardNamesById()
    return samples.map { sample ->
      val estimate = deriveBatteryPercent(sample.state, configs)?.let {
        windows.getOrPut(sample.state.boardId) { SocMedianWindow(windowMs) }
          .median(it, sample.state.capturedAtMs)
      }
      sample.state.toSampleMap(
        sample.id,
        boardNames[sample.state.boardId] ?: UNKNOWN_TELEMETRY_BOARD_NAME,
        estimate,
      )
    }
  }

  /**
   * Columnar binary encoding of [smoothedSampleMaps] for the history read path. Each sample is 25
   * little-endian Float64 lanes packed row-major into one direct ByteBuffer, returned as a JSI
   * ArrayBuffer. This replaces ~25 per-field JSI conversions × N samples (the dominant history-load
   * cost) with a single buffer transfer; JS rebuilds TelemetrySample objects locally. Nullable
   * numeric lanes use NaN as the null sentinel; the Board id and name are dictionary-encoded.
   *
   * @parity /modules/vescape-core/ios/telemetry/TelemetryRangePayload.swift `sampleColumns`
   */
  private suspend fun smoothedSampleColumns(
    samples: List<HistoryTelemetryState>,
    configs: Map<String, Map<String, Any?>>,
    boardNames: Map<String, String>,
  ): Map<String, Any?> {
    val windowMs = AppDataRepository.get(appContext).getTypedSettings().socEstimateWindowSeconds * 1000L
    val windows = HashMap<String?, SocMedianWindow>()
    val boardIds = ArrayList<String?>()
    val names = ArrayList<String>()
    val boardIndex = HashMap<String?, Int>()
    val buffer = ByteBuffer
      .allocateDirect(samples.size * SAMPLE_COLUMN_COUNT * 8)
      .order(ByteOrder.LITTLE_ENDIAN)
    val overviewIndices = evenlySpacedIndices(samples.size, HISTORY_CHART_OVERVIEW_SAMPLES)
    val overviewBuffer = ByteBuffer
      .allocateDirect(overviewIndices.size * SAMPLE_COLUMN_COUNT * 8)
      .order(ByteOrder.LITTLE_ENDIAN)
    var overviewCursor = 0
    for ((sampleIndex, sample) in samples.withIndex()) {
      val s = sample.state
      val estimate = deriveBatteryPercent(s, configs)?.let {
        windows.getOrPut(s.boardId) { SocMedianWindow(windowMs) }.median(it, s.capturedAtMs)
      }
      val di = boardIndex.getOrPut(s.boardId) {
        boardIds.add(s.boardId)
        names.add(boardNames[s.boardId] ?: UNKNOWN_TELEMETRY_BOARD_NAME)
        boardIds.size - 1
      }
      buffer
        .putDouble(sample.id.toDouble())
        .putDouble(s.capturedAtMs.toDouble())
        .putDouble(di.toDouble())
        .putDouble(s.speedCentiKmh / 100.0)
        .putDouble(s.batteryVoltageMv / 1000.0)
        .putDouble(estimate ?: Double.NaN)
        .putDouble(s.motorCurrentMa / 1000.0)
        .putDouble(s.batteryCurrentMa / 1000.0)
        .putDouble(s.dutyPermille / 1000.0)
        .putDouble(s.pitchCentiDeg / 100.0)
        .putDouble(s.rollCentiDeg / 100.0)
        .putDouble(s.balancePitchCentiDeg / 100.0)
        .putDouble(s.balanceCurrentMa / 1000.0)
        .putDouble(s.erpm.toDouble())
        .putDouble(s.state.toDouble())
        .putDouble(s.switchState.toDouble())
        .putDouble(s.adc1Milli / 1000.0)
        .putDouble(s.adc2Milli / 1000.0)
        .putDouble(s.odometerCm?.let { it / 100.0 } ?: Double.NaN)
        .putDouble(s.tempMosfetDeciC?.let { it / 10.0 } ?: Double.NaN)
        .putDouble(s.tempMotorDeciC?.let { it / 10.0 } ?: Double.NaN)
        .putDouble(s.location?.latitudeE7?.let { it / 10_000_000.0 } ?: Double.NaN)
        .putDouble(s.location?.longitudeE7?.let { it / 10_000_000.0 } ?: Double.NaN)
      if (overviewCursor < overviewIndices.size && overviewIndices[overviewCursor] == sampleIndex) {
        val rowStart = sampleIndex * SAMPLE_COLUMN_COUNT * 8
        val row = buffer.duplicate().apply {
          position(rowStart)
          limit(rowStart + SAMPLE_COLUMN_COUNT * 8)
        }.slice()
        overviewBuffer.put(row)
        overviewCursor += 1
      }
    }
    return mapOf(
      "boardColumns" to NativeArrayBuffer.wrap(buffer),
      "boardCount" to samples.size,
      "boardIds" to boardIds,
      "boardNames" to names,
      "chartColumns" to NativeArrayBuffer.wrap(overviewBuffer),
      "chartCount" to overviewIndices.size,
    )
  }

  private fun evenlySpacedIndices(count: Int, limit: Int): IntArray {
    if (count <= limit) return IntArray(count) { it }
    val denominator = limit - 1L
    return IntArray(limit) { index ->
      ((index * (count - 1L) + denominator / 2L) / denominator).toInt()
    }
  }

  /**
   * `boards.id` -> the Board's normalized battery config. Keyed on the Board rather than its BLE
   * identifier now that samples carry the Board id (ADR 0028), so a re-linked Board keeps its
   * config across its whole history.
   */
  private suspend fun batteryConfigByBoard(): Map<String, Map<String, Any?>> {
    BatterySocEstimator.ensureInitialized(appContext)
    val result = mutableMapOf<String, Map<String, Any?>>()
    for (board in AppDataRepository.get(appContext).getBoards()) {
      val id = board["id"] as? String ?: continue
      @Suppress("UNCHECKED_CAST")
      val config = board["batteryConfig"] as? Map<String, Any?> ?: continue
      result[id] = config
    }
    return result
  }

  /**
   * `boards.id` -> Board name, tombstones included: Ride History still has to name a Board the
   * Rider deleted (ADR 0027), and resolving on read is what makes a rename retroactive.
   */
  private suspend fun boardNamesById(): Map<String, String> =
    dao.getBoardNames().associate { it.id to it.name }

  /** Derive IR-compensated battery % on read, mirroring the live native path. */
  private fun deriveBatteryPercent(
    state: FullTelemetryState,
    configs: Map<String, Map<String, Any?>>,
  ): Double? {
    val config = state.boardId?.let { configs[it] } ?: return null
    return BatterySocEstimator.estimateBatteryPercent(
      state.batteryVoltageMv / 1000.0,
      config,
      state.batteryCurrentMa / 1000.0,
    )
  }

  private suspend fun getSampleStates(
    fromMs: Long,
    toMs: Long,
    boardId: String?,
    limit: Int,
  ): List<HistoryTelemetryState> {
    val keyframe = dao.getLatestKeyframeBefore(fromMs, boardId)
    val start = keyframe?.capturedAtMs ?: fromMs
    val frames = dao.getFrames(start, toMs, boardId, limit + 1)
    var state: FullTelemetryState? = null
    val samples = mutableListOf<HistoryTelemetryState>()
    for (frame in frames) {
      state = FullTelemetryState.applyFrame(state, frame)
      val current = state ?: continue
      if (frame.capturedAtMs < fromMs) continue
      samples.add(HistoryTelemetryState(frame.id, current))
      if (samples.size >= limit) break
    }
    return samples
  }

  suspend fun getRange(options: Map<String, Any?>): Map<String, Any?> = withContext(Dispatchers.IO) {
    val query = SampleQueryOptions.from(options)
    val samples = getSampleStates(query.fromMs, query.toMs, query.boardId, query.limit)
    val configs = batteryConfigByBoard()
    val boardNames = boardNamesById()
    smoothedSampleColumns(samples, configs, boardNames) + mapOf(
      "gpsSamples" to samples.toGpsSampleMaps(boardNames),
      "markers" to dao.getMarkers(query.fromMs, query.toMs, query.boardId).map { it.toMap() },
      "exclusions" to dao.getExclusions(query.fromMs, query.toMs, query.boardId).map { it.toMap() },
    )
  }

  suspend fun getSummary(): Map<String, Any?> = withContext(Dispatchers.IO) {
    mapOf(
      "sampleCount" to dao.countFrames(),
      "gpsPointCount" to dao.countTelemetryGpsPoints(),
      "firstAtMs" to dao.firstFrameAt(),
      "lastAtMs" to dao.lastFrameAt(),
      "droppedPendingSamples" to synchronized(lock) { droppedPendingFrames },
    )
  }

  suspend fun getDiagnosticEvents(options: Map<String, Any?>): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    val query = DiagnosticQueryOptions.from(options)
    dao.getDiagnosticEvents(query.fromMs, query.toMs, query.boardId, query.limit).map { it.toMap() }
  }

  suspend fun clearDiagnosticEvents() = withContext(Dispatchers.IO) {
    dao.clearDiagnosticEvents()
  }

  /**
   * Retention sweep. Age-only while this database has never been bound to an Account, and age plus
   * the accepted Sync Cursor once it has — cleanup must not remove a row the uploader has not
   * delivered (#284).
   */
  suspend fun deleteBefore(beforeMs: Long): Int = withContext(Dispatchers.IO) {
    dao.deleteBeforeGated(beforeMs)
  }

  suspend fun deleteRange(options: Map<String, Any?>): Int = withContext(Dispatchers.IO) {
    val query = RangeMutationOptions.from(options)
    flushNow()
    val requested = TelemetryTimeRange(query.fromMs, query.toMs)
    val protected = favoriteTelemetryRanges()
    promoteProtectedRangeStarts(protected, query.boardId)
    val deleted = subtractProtectedTelemetryRanges(requested, protected).sumOf { range ->
      dao.deleteRange(range.startMs, range.endMs, query.boardId)
    }
    deleted
  }

  // Favorites (ADR 0029)

  /**
   * Board names are resolved here, not stored on the row: a Favorite outlives board renames, and a
   * snapshot would drift.
   *
   * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `getFavorites`
   */
  suspend fun getFavorites(): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    favoriteMediaStore.reconcileAll()
    val boardNames = boardNamesById()
    dao.getFavorites().map { favorite ->
      favorite.toMap(boardNames[favorite.boardId], favoriteRoutePoints(favorite))
    }
  }

  /** Coarse native route projection for Favorite cards, independent of JS history pagination. */
  private suspend fun favoriteRoutePoints(favorite: FavoriteEntity): List<Map<String, Double>> {
    val fromBucketMs = favorite.startMs - (favorite.startMs % TELEMETRY_BUCKET_SIZE_MS)
    return dao.getHistoryBuckets(
      fromMs = fromBucketMs,
      toMs = favorite.endMs,
      beforeMs = favorite.endMs,
      boardId = null,
      limit = Int.MAX_VALUE,
    ).asReversed()
      .filter { it.firstSampleAtMs <= favorite.endMs && it.lastSampleAtMs >= favorite.startMs }
      .mapNotNull { bucket ->
        val latitude = bucket.firstLatitudeE7 ?: return@mapNotNull null
        val longitude = bucket.firstLongitudeE7 ?: return@mapNotNull null
        mapOf("latitude" to latitude / 1e7, "longitude" to longitude / 1e7)
      }
  }

  /**
   * Pin a time range as a Favorite. Identity and timestamps are minted here — the range and the
   * optional name are the only things JS gets to supply. Summary stats come from the raw samples
   * inside the range, so a range that cuts mid-bucket still gets exact numbers.
   *
   * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `createFavorite`
   */
  suspend fun createFavorite(options: Map<String, Any?>): Map<String, Any?>? = withContext(Dispatchers.IO) {
    val range = favoriteRange(options) ?: return@withContext null
    val startMs = range.startMs
    val endMs = range.endMs
    val boardId = options["boardId"] as? String
    val name = (options["name"] as? String)?.trim()?.ifEmpty { null }
    flushNow()

    val states = getSampleStates(startMs, endMs, boardId, Int.MAX_VALUE)
    val summary = favoriteSummary(states)
    val nowMs = System.currentTimeMillis()
    val favorite = FavoriteEntity(
      id = UUID.randomUUID().toString(),
      boardId = boardId,
      name = name,
      startMs = startMs,
      endMs = endMs,
      createdAt = nowMs,
      updatedAt = nowMs,
      sampleCount = summary.sampleCount,
      gpsPointCount = summary.gpsPointCount,
      distanceCm = summary.distanceCm,
      movingDurationMs = summary.movingDurationMs,
      avgSpeedCentiKmh = summary.avgSpeedCentiKmh,
      maxSpeedCentiKmh = summary.maxSpeedCentiKmh,
      batteryUsedWhMilli = summary.batteryUsedWhMilli,
    )
    dao.insertFavorite(favorite)
    SyncCoordinator.get(appContext).notifyRiderEdit()
    favorite.toMap(
      boardId?.let { boardNamesById()[it] },
      favoriteRoutePoints(favorite),
    )
  }

  /**
   * Re-trim/rename a Favorite in place. Identity, creation time and Favorite Media stay attached;
   * summary stats are rebuilt from raw samples for the new exact range.
   *
   * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `updateFavorite`
   */
  suspend fun updateFavorite(
    id: String,
    options: Map<String, Any?>,
  ): Map<String, Any?>? = withContext(Dispatchers.IO) {
    val existing = dao.getFavorite(id) ?: return@withContext null
    val range = favoriteRange(options) ?: return@withContext null
    val startMs = range.startMs
    val endMs = range.endMs
    val boardId = options["boardId"] as? String
    val name = (options["name"] as? String)?.trim()?.ifEmpty { null }
    flushNow()

    val summary = favoriteSummary(getSampleStates(startMs, endMs, boardId, Int.MAX_VALUE))
    val updated = existing.copy(
      name = name,
      startMs = startMs,
      endMs = endMs,
      updatedAt = System.currentTimeMillis(),
      sampleCount = summary.sampleCount,
      gpsPointCount = summary.gpsPointCount,
      distanceCm = summary.distanceCm,
      movingDurationMs = summary.movingDurationMs,
      avgSpeedCentiKmh = summary.avgSpeedCentiKmh,
      maxSpeedCentiKmh = summary.maxSpeedCentiKmh,
      batteryUsedWhMilli = summary.batteryUsedWhMilli,
    )
    if (dao.updateFavorite(updated) == 0) return@withContext null
    SyncCoordinator.get(appContext).notifyRiderEdit()
    updated.toMap(
      updated.boardId?.let { boardNamesById()[it] },
      favoriteRoutePoints(updated),
    )
  }

  /**
   * Unpin a Favorite. Telemetry in its range stays and becomes normally deletable (ADR 0029).
   *
   * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `deleteFavorite`
   */
  suspend fun deleteFavorite(id: String): Boolean = withContext(Dispatchers.IO) {
    val deleted = dao.deleteFavorite(id) > 0
    if (deleted) {
      favoriteMediaStore.deleteDirectory(id)
      SyncCoordinator.get(appContext).notifyRiderEdit()
    }
    deleted
  }

  /**
   * Read and reconcile Favorite Media. Missing files remove their manifest rows; temp/orphan files
   * are deleted and never published to JS.
   *
   * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `getFavoriteMedia`
   */
  suspend fun getFavoriteMedia(favoriteId: String): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    favoriteMediaStore.list(favoriteId)
  }

  /**
   * Copy picker bytes into canonical app storage, hashing as they stream, then publish the
   * immutable manifest only after the final file exists.
   *
   * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `importFavoriteMedia`
   */
  suspend fun importFavoriteMedia(options: Map<String, Any?>): Map<String, Any?> = withContext(Dispatchers.IO) {
    favoriteMediaStore.importMedia(options)
  }

  /**
   * Run the raw samples of a Favorite range through the same Metric Sanitizers the recording flush
   * applies, then collapse the resulting buckets into one denormalized summary. Exclusion ranges are
   * deliberately not persisted: creating a Favorite is a read of Ride History, not a rewrite.
   *
   * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `favoriteSummary`
   */
  private fun favoriteSummary(states: List<HistoryTelemetryState>): FavoriteSummary {
    if (states.isEmpty()) return FavoriteSummary()
    val telemetryPoints = states.map { it.state.toBucketPoint() }
    val sanitization = sanitizeTelemetrySamples(telemetryPoints, metricSanitizerConfig)
    val sanitizedPoints = telemetryPoints.mapIndexed { index, point ->
      point.copy(
        excludedFromAvgSpeed = sanitization.samples[index].excludedFromAvgSpeed,
        excludedFromMaxSpeed = sanitization.samples[index].excludedFromMaxSpeed,
        excludedFromMaxDuty = sanitization.samples[index].excludedFromMaxDuty,
      )
    }
    return buildFavoriteSummary(
      buildTelemetryBuckets(
        telemetryPoints = sanitizedPoints,
        locationPoints = states.toBucketLocationPoints(),
      ),
    )
  }

  suspend fun rebuildBuckets(onProgress: (current: Int, total: Int) -> Unit = { _, _ -> }): Int = withContext(Dispatchers.IO) {
    val firstMs = dao.firstFrameAt() ?: return@withContext 0
    val lastMs = dao.lastFrameAt() ?: return@withContext 0

    dao.clearBuckets()
    dao.clearExclusions()

    val chunkMs = 3_600_000L
    val chunks = ((lastMs - firstMs) / chunkMs + 1).toInt()
    var rebuiltBuckets = 0
    onProgress(0, chunks)

    for (i in 0 until chunks) {
      val chunkFrom = firstMs + i * chunkMs
      val chunkTo = minOf(chunkFrom + chunkMs - 1, lastMs)

      val states = getSampleStates(chunkFrom, chunkTo, null, Int.MAX_VALUE)
      if (states.isNotEmpty()) {
        val telemetryPoints = states.map { it.state.toBucketPoint() }
        val sanitization = sanitizeTelemetrySamples(telemetryPoints, metricSanitizerConfig)
        val sanitizedPoints = telemetryPoints.mapIndexed { index, point ->
          point.copy(
            excludedFromAvgSpeed = sanitization.samples[index].excludedFromAvgSpeed,
            excludedFromMaxSpeed = sanitization.samples[index].excludedFromMaxSpeed,
            excludedFromMaxDuty = sanitization.samples[index].excludedFromMaxDuty,
          )
        }
        if (sanitization.exclusions.isNotEmpty()) dao.upsertExclusionRanges(sanitization.exclusions)
        val buckets = buildTelemetryBuckets(
          telemetryPoints = sanitizedPoints,
          locationPoints = states.toBucketLocationPoints(),
        )
        if (buckets.isNotEmpty()) {
          dao.upsertBuckets(buckets)
          rebuiltBuckets += buckets.size
        }
      }
      onProgress(i + 1, chunks)
    }

    Log.i(TAG, "rebuildBuckets complete: $rebuiltBuckets buckets from $chunks chunks")
    rebuiltBuckets
  }

  suspend fun clearAll() = withContext(Dispatchers.IO) {
    flushNow()
    val protected = favoriteTelemetryRanges()
    if (protected.isEmpty()) {
      dao.clearAll()
    } else {
      promoteProtectedRangeStarts(protected, boardId = null)
      val requested = TelemetryTimeRange(Long.MIN_VALUE, Long.MAX_VALUE)
      for (range in subtractProtectedTelemetryRanges(requested, protected)) {
        dao.deleteRangeAllDevices(range.startMs, range.endMs)
      }
      dao.clearDiagnosticEvents()
    }
    synchronized(lock) {
      pending.clear()
      pendingMarkers.clear()
      lastState = null
      lastFrameAtMs = null
      lastHistoryAtMs = null
      lastKeyframeAtMs = null
      forceNextKeyframe = true
    }
  }

  /**
   * Favorites protect time ranges globally. A Board can be re-linked after a Favorite is created,
   * so its current BLE id cannot safely identify the historical telemetry device id.
   *
   * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `favoriteTelemetryRanges`
   */
  private suspend fun favoriteTelemetryRanges(): List<TelemetryTimeRange> =
    dao.getFavorites().map {
      expandTelemetryRangeToBuckets(TelemetryTimeRange(it.startMs, it.endMs))
    }

  /**
   * Android stores delta frames. Promote the first retained frame in each protected island before
   * deleting its predecessor, otherwise the Favorite could survive in SQLite but become undecodable.
   *
   * iOS stores full keyframe rows for every sample and needs no promotion.
   */
  private suspend fun promoteProtectedRangeStarts(
    protected: Collection<TelemetryTimeRange>,
    boardId: String?,
  ) {
    for (range in protected) {
      val boards = if (boardId != null) {
        listOf(boardId)
      } else {
        dao.getBoardIdsInRange(range.startMs, range.endMs)
      }
      for (protectedBoardId in boards) {
        val firstFrame = dao.getFirstFrameInRange(
          range.startMs,
          range.endMs,
          protectedBoardId,
        ) ?: continue
        val first = getSampleStates(
          range.startMs,
          firstFrame.capturedAtMs,
          protectedBoardId,
          Int.MAX_VALUE,
        ).firstOrNull { it.id == firstFrame.id } ?: continue
        dao.updateFrame(first.state.toFrame(previous = null, keyframe = true).copy(id = first.id))
      }
    }
  }

  private fun scheduleFlushLocked() {
    if (flushScheduled) return
    flushScheduled = true
    scope.launch {
      delay(FLUSH_DELAY_MS)
      flushNow()
    }
  }

  private suspend fun flushNow() {
    val frames: List<PendingFrame>
    val bucketStates: List<FullTelemetryState>
    val markers: List<TelemetryMarkerEntity>
    synchronized(lock) {
      if (pending.isEmpty() && pendingBucketStates.isEmpty() && pendingMarkers.isEmpty()) {
        flushScheduled = false
        return
      }
      frames = pending.toList()
      bucketStates = pendingBucketStates.toList()
      markers = pendingMarkers.toList()
      pending.clear()
      pendingBucketStates.clear()
      pendingMarkers.clear()
      flushScheduled = false
    }

    try {
      val zones = enabledPrivacyZones
      // Persisted detail trace (2 Hz).
      val filteredFrames = if (zones.isEmpty()) frames else frames.filter { pending ->
        val loc = pending.state.location ?: return@filter true
        !isInsideAnyPrivacyZone(loc.latitudeE7, loc.longitudeE7, zones)
      }
      // Bucket source (full rate) — aggregates stay exact.
      val filteredStates = if (zones.isEmpty()) bucketStates else bucketStates.filter { state ->
        val loc = state.location ?: return@filter true
        !isInsideAnyPrivacyZone(loc.latitudeE7, loc.longitudeE7, zones)
      }
      if (filteredFrames.isEmpty() && filteredStates.isEmpty() && markers.isEmpty()) return

      val telemetryPoints = filteredStates.map { it.toBucketPoint() }
      val sanitization = sanitizeTelemetrySamples(telemetryPoints, metricSanitizerConfig)
      val sanitizedPoints = telemetryPoints.mapIndexed { index, point ->
        point.copy(
          excludedFromAvgSpeed = sanitization.samples[index].excludedFromAvgSpeed,
          excludedFromMaxSpeed = sanitization.samples[index].excludedFromMaxSpeed,
          excludedFromMaxDuty = sanitization.samples[index].excludedFromMaxDuty,
        )
      }
      dao.insertBatch(
        frames = filteredFrames.map { it.frame },
        buckets = buildTelemetryBuckets(
          telemetryPoints = sanitizedPoints,
          locationPoints = filteredStates.map { HistoryTelemetryState(0L, it) }.toBucketLocationPoints(),
        ),
        markers = markers,
        exclusions = sanitization.exclusions,
      )
      // Samples are actually being produced, which is what the uploader's ride cadence follows —
      // Idle Pause halts production without ending the Board Session.
      SyncCoordinator.get(appContext).notifySamplesPersisted()
    } catch (e: Exception) {
      Log.w(TAG, "Telemetry flush failed: ${e.message}")
    }
  }

  companion object {
    @Volatile
    private var instance: TelemetryRepository? = null

    fun get(context: Context): TelemetryRepository {
      return instance ?: synchronized(this) {
        instance ?: TelemetryRepository(context.applicationContext).also { instance = it }
      }
    }

    fun resetForDatabaseSwap() {
      synchronized(this) {
        instance?.shutdownForDatabaseSwap()
        instance = null
      }
    }
  }
}

private data class PendingFrame(
  val frame: TelemetryFrameEntity,
  val state: FullTelemetryState,
)

private data class HistoryQueryOptions(
  val fromMs: Long,
  val toMs: Long,
  val beforeMs: Long,
  val boardId: String?,
  val limit: Int,
) {
  companion object {
    fun from(options: Map<String, Any?>): HistoryQueryOptions {
      val toMs = options.long("toMs") ?: System.currentTimeMillis()
      return HistoryQueryOptions(
        fromMs = options.long("fromMs") ?: 0L,
        toMs = toMs,
        beforeMs = options.long("cursorBeforeMs") ?: toMs,
        boardId = options["boardId"] as? String,
        limit = (options.int("limit") ?: DEFAULT_HISTORY_LIMIT).coerceIn(1, 500),
      )
    }
  }
}

private data class DiagnosticQueryOptions(
  val fromMs: Long,
  val toMs: Long,
  val boardId: String?,
  val limit: Int,
) {
  companion object {
    fun from(options: Map<String, Any?>): DiagnosticQueryOptions {
      val toMs = options.long("toMs") ?: System.currentTimeMillis()
      return DiagnosticQueryOptions(
        fromMs = options.long("fromMs") ?: 0L,
        toMs = toMs,
        boardId = options["boardId"] as? String,
        limit = (options.int("limit") ?: 200).coerceIn(1, 1_000),
      )
    }
  }
}

private data class SampleQueryOptions(
  val fromMs: Long,
  val toMs: Long,
  val boardId: String?,
  val limit: Int,
) {
  companion object {
    fun from(options: Map<String, Any?>): SampleQueryOptions =
      SampleQueryOptions(
        fromMs = options.requiredLong("fromMs"),
        toMs = options.requiredLong("toMs"),
        boardId = options["boardId"] as? String,
        limit = (options.int("limit") ?: DEFAULT_SAMPLE_LIMIT).coerceIn(1, MAX_SAMPLE_LIMIT),
      )
  }
}

private data class RangeMutationOptions(
  val fromMs: Long,
  val toMs: Long,
  val boardId: String?,
) {
  companion object {
    fun from(options: Map<String, Any?>): RangeMutationOptions {
      val fromMs = options.requiredLong("fromMs")
      val toMs = options.requiredLong("toMs")
      require(toMs >= fromMs) { "toMs must be greater than or equal to fromMs" }
      return RangeMutationOptions(
        fromMs = fromMs,
        toMs = toMs,
        boardId = options["boardId"] as? String,
      )
    }
  }
}

internal data class HistoryTelemetryState(
  val id: Long,
  val state: FullTelemetryState,
)

internal data class FullTelemetryState(
  val capturedAtMs: Long,
  val elapsedRealtimeMs: Long,
  val boardId: String?,
  val canId: Int?,
  val speedCentiKmh: Int,
  val batteryVoltageMv: Int,
  val motorCurrentMa: Int,
  val batteryCurrentMa: Int,
  val dutyPermille: Int,
  val pitchCentiDeg: Int,
  val rollCentiDeg: Int,
  val balancePitchCentiDeg: Int,
  val balanceCurrentMa: Int,
  val erpm: Int,
  val state: Int,
  val switchState: Int,
  val adc1Milli: Int,
  val adc2Milli: Int,
  val odometerCm: Long?,
  val tempMosfetDeciC: Int?,
  val tempMotorDeciC: Int?,
  val location: ScaledLocation?,
) {
  fun toFrame(previous: FullTelemetryState?, keyframe: Boolean): TelemetryFrameEntity {
    var mask1 = 0
    var mask2 = 0
    fun include(changed: Boolean, mask: Int): Boolean {
      if (keyframe || changed) {
        mask1 = mask1 or mask
        return true
      }
      return false
    }
    val includeLocation = keyframe || locationChanged(previous?.location, location)
    if (includeLocation) mask2 = mask2 or TELEMETRY_MASK2_LOCATION
    val flags = (if (keyframe) TELEMETRY_FLAG_KEYFRAME else 0) or
      (if (location != null) TELEMETRY_FLAG_HAS_LOCATION else 0)

    return TelemetryFrameEntity(
      capturedAtMs = capturedAtMs,
      elapsedRealtimeMs = elapsedRealtimeMs,
      boardId = boardId,
      canId = canId,
      flags = flags,
      changedMask1 = 0,
      changedMask2 = 0,
      speedCentiKmh = if (include(changedBy(previous?.speedCentiKmh, speedCentiKmh, 5), TELEMETRY_MASK_SPEED)) speedCentiKmh else null,
      batteryVoltageMv = if (include(changedBy(previous?.batteryVoltageMv, batteryVoltageMv, 20), TELEMETRY_MASK_BATTERY_VOLTAGE)) batteryVoltageMv else null,
      motorCurrentMa = if (include(changedBy(previous?.motorCurrentMa, motorCurrentMa, 100), TELEMETRY_MASK_MOTOR_CURRENT)) motorCurrentMa else null,
      batteryCurrentMa = if (include(changedBy(previous?.batteryCurrentMa, batteryCurrentMa, 100), TELEMETRY_MASK_BATTERY_CURRENT)) batteryCurrentMa else null,
      dutyPermille = if (include(changedBy(previous?.dutyPermille, dutyPermille, 2), TELEMETRY_MASK_DUTY)) dutyPermille else null,
      pitchCentiDeg = if (include(changedBy(previous?.pitchCentiDeg, pitchCentiDeg, 5), TELEMETRY_MASK_PITCH)) pitchCentiDeg else null,
      rollCentiDeg = if (include(changedBy(previous?.rollCentiDeg, rollCentiDeg, 5), TELEMETRY_MASK_ROLL)) rollCentiDeg else null,
      balancePitchCentiDeg = if (include(changedBy(previous?.balancePitchCentiDeg, balancePitchCentiDeg, 5), TELEMETRY_MASK_BALANCE_PITCH)) balancePitchCentiDeg else null,
      balanceCurrentMa = if (include(changedBy(previous?.balanceCurrentMa, balanceCurrentMa, 100), TELEMETRY_MASK_BALANCE_CURRENT)) balanceCurrentMa else null,
      erpm = if (include(previous?.erpm != erpm, TELEMETRY_MASK_ERPM)) erpm else null,
      state = if (include(previous?.state != state, TELEMETRY_MASK_STATE)) state else null,
      switchState = if (include(previous?.switchState != switchState, TELEMETRY_MASK_SWITCH_STATE)) switchState else null,
      adc1Milli = if (include(changedBy(previous?.adc1Milli, adc1Milli, 10), TELEMETRY_MASK_ADC1)) adc1Milli else null,
      adc2Milli = if (include(changedBy(previous?.adc2Milli, adc2Milli, 10), TELEMETRY_MASK_ADC2)) adc2Milli else null,
      odometerCm = if (include(changedBy(previous?.odometerCm, odometerCm, 25), TELEMETRY_MASK_ODOMETER)) odometerCm else null,
      tempMosfetDeciC = if (include(changedBy(previous?.tempMosfetDeciC, tempMosfetDeciC, 5), TELEMETRY_MASK_TEMP_MOSFET)) tempMosfetDeciC else null,
      tempMotorDeciC = if (include(changedBy(previous?.tempMotorDeciC, tempMotorDeciC, 5), TELEMETRY_MASK_TEMP_MOTOR)) tempMotorDeciC else null,
      latitudeE7 = if (includeLocation) location?.latitudeE7 else null,
      longitudeE7 = if (includeLocation) location?.longitudeE7 else null,
      gpsSpeedCentiMps = if (includeLocation) location?.gpsSpeedCentiMps else null,
      bearingCentiDeg = if (includeLocation) location?.bearingCentiDeg else null,
      accuracyCm = if (includeLocation) location?.accuracyCm else null,
      altitudeCm = if (includeLocation) location?.altitudeCm else null,
      locationTimestampMs = if (includeLocation) location?.timestampMs else null,
    ).copy(changedMask1 = mask1, changedMask2 = mask2)
  }

  /** Board name is resolved by the caller from `boards`, never read off the row (ADR 0028). */
  fun toSampleMap(id: Long, boardName: String?, batteryPercent: Double? = null): Map<String, Any?> = mapOf(
    "id" to id,
    "capturedAtMs" to capturedAtMs,
    "boardId" to boardId,
    "boardName" to boardName,
    "speedKmh" to speedCentiKmh / 100.0,
    "batteryVoltage" to batteryVoltageMv / 1000.0,
    "batteryPercent" to batteryPercent,
    "motorCurrent" to motorCurrentMa / 1000.0,
    "batteryCurrent" to batteryCurrentMa / 1000.0,
    "dutyCycle" to dutyPermille / 1000.0,
    "pitch" to pitchCentiDeg / 100.0,
    "roll" to rollCentiDeg / 100.0,
    "balancePitch" to balancePitchCentiDeg / 100.0,
    "balanceCurrent" to balanceCurrentMa / 1000.0,
    "erpm" to erpm,
    "state" to state,
    "switchState" to switchState,
    "adc1" to adc1Milli / 1000.0,
    "adc2" to adc2Milli / 1000.0,
    "odometer" to odometerCm?.let { it / 100.0 },
    "tempMosfet" to tempMosfetDeciC?.let { it / 10.0 },
    "tempMotor" to tempMotorDeciC?.let { it / 10.0 },
    "latitude" to location?.latitudeE7?.let { it / 10_000_000.0 },
    "longitude" to location?.longitudeE7?.let { it / 10_000_000.0 },
  )

  fun toBucketPoint(): BucketTelemetryPoint = BucketTelemetryPoint(
    capturedAtMs = capturedAtMs,
    boardId = boardId,
    speedCentiKmh = speedCentiKmh,
    batteryVoltageMv = batteryVoltageMv,
    motorCurrentMa = motorCurrentMa,
    batteryCurrentMa = batteryCurrentMa,
    dutyPermille = dutyPermille,
    odometerCm = odometerCm,
    tempMosfetDeciC = tempMosfetDeciC,
    tempMotorDeciC = tempMotorDeciC,
    gpsSpeedCentiMps = location?.gpsSpeedCentiMps,
    gpsTimestampMs = location?.timestampMs,
    gpsAccuracyCm = location?.accuracyCm,
  )

  companion object {
    fun from(capture: TelemetryCapture): FullTelemetryState = FullTelemetryState(
      capturedAtMs = capture.capturedAtMs,
      elapsedRealtimeMs = capture.elapsedRealtimeMs,
      boardId = capture.boardId,
      canId = capture.canId,
      speedCentiKmh = (capture.speed * 100.0).roundToInt(),
      batteryVoltageMv = (capture.batteryVoltage * 1000.0).roundToInt(),
      motorCurrentMa = (capture.motorCurrent * 1000.0).roundToInt(),
      batteryCurrentMa = (capture.batteryCurrent * 1000.0).roundToInt(),
      dutyPermille = (capture.dutyCycle * 1000.0).roundToInt(),
      pitchCentiDeg = (capture.pitch * 100.0).roundToInt(),
      rollCentiDeg = (capture.roll * 100.0).roundToInt(),
      balancePitchCentiDeg = (capture.balancePitch * 100.0).roundToInt(),
      balanceCurrentMa = (capture.balanceCurrent * 1000.0).roundToInt(),
      erpm = capture.erpm,
      state = capture.state,
      switchState = capture.switchState,
      adc1Milli = (capture.adc1 * 1000.0).roundToInt(),
      adc2Milli = (capture.adc2 * 1000.0).roundToInt(),
      odometerCm = capture.odometer?.let { (it * 100.0).roundToLong() },
      tempMosfetDeciC = capture.tempMosfet?.let { (it * 10.0).roundToInt() },
      tempMotorDeciC = capture.tempMotor?.let { (it * 10.0).roundToInt() },
      location = capture.location?.let { ScaledLocation.from(it) },
    )

    fun applyFrame(previous: FullTelemetryState?, frame: TelemetryFrameEntity): FullTelemetryState? {
      val base = previous
      fun <T> pick(value: T?, fallback: T?): T? = value ?: fallback
      val speed = pick(frame.speedCentiKmh, base?.speedCentiKmh) ?: return null
      val voltage = pick(frame.batteryVoltageMv, base?.batteryVoltageMv) ?: return null
      val motorCurrent = pick(frame.motorCurrentMa, base?.motorCurrentMa) ?: return null
      val batteryCurrent = pick(frame.batteryCurrentMa, base?.batteryCurrentMa) ?: return null
      val duty = pick(frame.dutyPermille, base?.dutyPermille) ?: return null
      val pitch = pick(frame.pitchCentiDeg, base?.pitchCentiDeg) ?: return null
      val roll = pick(frame.rollCentiDeg, base?.rollCentiDeg) ?: return null
      val balancePitch = pick(frame.balancePitchCentiDeg, base?.balancePitchCentiDeg) ?: return null
      val balanceCurrent = pick(frame.balanceCurrentMa, base?.balanceCurrentMa) ?: return null
      val erpm = pick(frame.erpm, base?.erpm) ?: return null
      val state = pick(frame.state, base?.state) ?: return null
      val switchState = pick(frame.switchState, base?.switchState) ?: return null
      val adc1 = pick(frame.adc1Milli, base?.adc1Milli) ?: return null
      val adc2 = pick(frame.adc2Milli, base?.adc2Milli) ?: return null
      val location = if ((frame.changedMask2 and TELEMETRY_MASK2_LOCATION) != 0) {
        ScaledLocation.fromFrame(frame)
      } else {
        base?.location
      }
      return FullTelemetryState(
        capturedAtMs = frame.capturedAtMs,
        elapsedRealtimeMs = frame.elapsedRealtimeMs,
        boardId = frame.boardId ?: base?.boardId,
        canId = frame.canId ?: base?.canId,
        speedCentiKmh = speed,
        batteryVoltageMv = voltage,
        motorCurrentMa = motorCurrent,
        batteryCurrentMa = batteryCurrent,
        dutyPermille = duty,
        pitchCentiDeg = pitch,
        rollCentiDeg = roll,
        balancePitchCentiDeg = balancePitch,
        balanceCurrentMa = balanceCurrent,
        erpm = erpm,
        state = state,
        switchState = switchState,
        adc1Milli = adc1,
        adc2Milli = adc2,
        odometerCm = pick(frame.odometerCm, base?.odometerCm),
        tempMosfetDeciC = pick(frame.tempMosfetDeciC, base?.tempMosfetDeciC),
        tempMotorDeciC = pick(frame.tempMotorDeciC, base?.tempMotorDeciC),
        location = location,
      )
    }
  }
}

internal data class ScaledLocation(
  val latitudeE7: Int,
  val longitudeE7: Int,
  val gpsSpeedCentiMps: Int?,
  val bearingCentiDeg: Int?,
  val accuracyCm: Int?,
  val altitudeCm: Int?,
  val timestampMs: Long,
) {
  companion object {
    fun from(location: TelemetryLocationCapture): ScaledLocation = ScaledLocation(
      latitudeE7 = (location.latitude * 10_000_000.0).roundToInt(),
      longitudeE7 = (location.longitude * 10_000_000.0).roundToInt(),
      gpsSpeedCentiMps = location.speedMps?.let { (it * 100.0).roundToInt() },
      bearingCentiDeg = location.bearingDeg?.let { (it * 100.0).roundToInt() },
      accuracyCm = location.accuracyM?.let { (it * 100.0).roundToInt() },
      altitudeCm = location.altitudeM?.let { (it * 100.0).roundToInt() },
      timestampMs = location.timestamp,
    )

    fun fromFrame(frame: TelemetryFrameEntity): ScaledLocation? {
      val lat = frame.latitudeE7 ?: return null
      val lon = frame.longitudeE7 ?: return null
      return ScaledLocation(
        latitudeE7 = lat,
        longitudeE7 = lon,
        gpsSpeedCentiMps = frame.gpsSpeedCentiMps,
        bearingCentiDeg = frame.bearingCentiDeg,
        accuracyCm = frame.accuracyCm,
        altitudeCm = frame.altitudeCm,
        timestampMs = frame.locationTimestampMs ?: frame.capturedAtMs,
      )
    }
  }
}

private fun changedBy(previous: Int?, current: Int, threshold: Int): Boolean =
  previous == null || abs(current - previous) >= threshold

private fun changedBy(previous: Long?, current: Long?, threshold: Long): Boolean =
  previous != current && (previous == null || current == null || abs(current - previous) >= threshold)

private fun changedBy(previous: Int?, current: Int?, threshold: Int): Boolean =
  previous != current && (previous == null || current == null || abs(current - previous) >= threshold)

private fun locationChanged(previous: ScaledLocation?, current: ScaledLocation?): Boolean {
  if (previous == null || current == null) return previous != current
  val latMeters = (current.latitudeE7 - previous.latitudeE7) * 0.0111
  val lonMeters = (current.longitudeE7 - previous.longitudeE7) * 0.0111
  val distanceChanged = abs(latMeters) > 2.0 || abs(lonMeters) > 2.0
  val accuracyChanged = changedBy(previous.accuracyCm, current.accuracyCm, 200)
  val timeChanged = current.timestampMs - previous.timestampMs > 5_000L
  return distanceChanged || accuracyChanged || timeChanged
}

private fun distanceDeltaM(bucket: TelemetryMinuteBucketEntity): Double? {
  val first = bucket.firstOdometerCm ?: return null
  val last = bucket.lastOdometerCm ?: return null
  return ((last - first).coerceAtLeast(0L)) / 100.0
}

private fun TelemetryMarkerEntity.toMap(): Map<String, Any?> = mapOf(
  "id" to id,
  "occurredAtMs" to occurredAtMs,
  "type" to type,
  "boardId" to boardId,
  "message" to message,
  "gapMs" to gapMs,
)

private fun MetricExclusionRangeEntity.toMap(): Map<String, Any?> = mapOf(
  "id" to id,
  "boardId" to boardId,
  "reason" to reason,
  "startMs" to startMs,
  "endMs" to endMs,
  "sampleCount" to sampleCount,
  "metrics" to metricsForExclusionReason(reason),
)

private fun metricsForExclusionReason(reason: String): Map<String, Boolean> =
  buildMap {
    when (reason) {
      EXCLUSION_REASON_LOW_SPEED -> put(METRIC_AVG_SPEED, true)
      EXCLUSION_REASON_FREE_SPIN -> {
        put(METRIC_MAX_SPEED, true)
        put(METRIC_MAX_DUTY, true)
      }
    }
  }

private fun DiagnosticEventEntity.toMap(): Map<String, Any?> = mapOf(
  "id" to id,
  "occurredAtMs" to occurredAtMs,
  "eventName" to eventName,
  "operation" to operation,
  "phase" to phase,
  "boardId" to boardId,
  "message" to message,
  "propertiesJson" to propertiesJson,
)

private fun sanitizeDiagnosticProperties(properties: Map<String, Any?>): Map<String, Any?> =
  properties.mapValues { (_, value) ->
    when (value) {
      is String, is Number, is Boolean, null -> value
      else -> value.toString()
    }
  }

private fun Map<String, Any?>.long(key: String): Long? = (this[key] as? Number)?.toLong()

private fun Map<String, Any?>.int(key: String): Int? = (this[key] as? Number)?.toInt()

/**
 * Favorite ranges are required bridge input. Invalid bounds return through the module's controlled
 * `ERR_CREATE_FAVORITE` / `ERR_UPDATE_FAVORITE` path instead of leaking IllegalArgumentException.
 *
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `favoriteRange`
 */
internal fun favoriteRange(options: Map<String, Any?>): TelemetryTimeRange? {
  val startMs = options.long("startMs") ?: return null
  val endMs = options.long("endMs") ?: return null
  return if (endMs >= startMs) TelemetryTimeRange(startMs, endMs) else null
}

private fun Map<String, Any?>.requiredLong(key: String): Long =
  long(key) ?: throw IllegalArgumentException("$key is required")
