package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.config.BoardConfigValues
import expo.modules.vescapecore.config.MotorConfigValues
import expo.modules.vescapecore.config.BoardConfigChangeNotice
import expo.modules.vescapecore.config.RefloatConfigSnapshot

import expo.modules.vescapecore.diagnostics.DiagnosticReporter

import expo.modules.vescapecore.service.CoreForegroundService

import expo.modules.vescapecore.connection.BoardTransport
import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import expo.modules.vescapecore.alerts.normalizedAlertBeepCount
import expo.modules.vescapecore.alerts.normalizedAlertRepeatSeconds

// @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `AppDataScope`
// @parity /modules/vescape-core/src/index.ts `AppDataChangedEvent`
/** Scope of an `onAppDataChanged` emit; mirrors the JS `AppDataChangedEvent['scope']` union. */
internal enum class AppDataScope(val wire: String) {
  BOARDS("boards"),
  SETTINGS("settings"),
}

internal fun validMapStyleKey(value: Any?): String? =
  (value as? String)?.takeIf { it in setOf("onedark", "outdoors", "satellite", "mapy") }

internal fun validThemeMode(value: Any?): String? =
  (value as? String)?.takeIf { it in setOf("system", "light", "dark", "sun") }

internal fun validMapOrientationMode(value: Any?): String? =
  (value as? String)?.takeIf { it in setOf("northUp", "gpsHeading", "phoneHeading", "freeRotate") }

internal fun validSatelliteImageryOpacity(value: Any?): Double? =
  (value as? Number)
    ?.toDouble()
    ?.takeIf { it.isFinite() }
    ?.coerceIn(0.1, 1.0)

internal fun validSatelliteImagerySaturation(value: Any?): Double? =
  (value as? Number)
    ?.toDouble()
    ?.takeIf { it.isFinite() }
    ?.coerceIn(-1.0, 1.0)

internal fun validLiveHistoryLimitMinutes(value: Any?): Int? =
  (value as? Number)
    ?.toInt()
    ?.coerceIn(MIN_LIVE_HISTORY_LIMIT_MINUTES, MAX_LIVE_HISTORY_LIMIT_MINUTES)

/** SoC Estimate median window in seconds; 0 disables smoothing, capped at 120s (ADR-0016). */
internal fun validSocEstimateWindowSeconds(value: Any?): Int? =
  (value as? Number)
    ?.toInt()
    ?.coerceIn(0, 120)

/** Max telemetry poll rate in Hz; 0 = unlimited (pure response-paced), capped at 100Hz. */
/** Board Move strength, percent of full remote input. Floored so a stored 0 cannot mean "no move". */
internal fun validBoardMoveStrengthPercent(value: Any?): Int? =
  (value as? Number)
    ?.toInt()
    ?.coerceIn(10, 100)

internal fun validTelemetryPollRateHz(value: Any?): Int? =
  (value as? Number)
    ?.toInt()
    ?.coerceIn(0, 100)

/** Companion auto-start pause after manual app exit, minutes; 0 = off, capped at 24h. */
internal fun validCompanionCooldownMinutes(value: Any?): Int? =
  (value as? Number)
    ?.toInt()
    ?.coerceIn(0, 1440)

/**
 * Acknowledged Community Message IDs: a de-duplicated list of non-empty ID strings, or `null` when
 * the raw value is not a list at all. An empty or all-invalid list normalizes to `[]` (not `null`)
 * so a legitimately-empty stored value is never treated as corrupt.
 */
internal fun validDismissedCommunityMessageIds(value: Any?): List<String>? {
  val list = value as? List<*> ?: return null
  return list.filterIsInstance<String>().filter { it.isNotEmpty() }.distinct()
}

/** Ride split gap in minutes; at least 1 so every ride can still end, capped at 24h. */
internal fun validRideSplitGapMinutes(value: Any?): Int? =
  (value as? Number)
    ?.toInt()
    ?.coerceIn(1, 1440)

/** Auto close delay in minutes; at least 1 so a fired timer always had a real wait. */
internal fun validAutoCloseDelayMinutes(value: Any?): Int? =
  (value as? Number)
    ?.toInt()
    ?.coerceIn(1, 1440)

/** Display default Board Top Speed in km/h, applied when a Board has no `topSpeedKmh` setting. */
internal const val DEFAULT_TOP_SPEED_KMH = 50.0

/**
 * Board Top Speed in km/h; the speed gauge full-scale. Clamped to a sane 5–150 km/h band.
 * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `topSpeedKmh`
 */
internal fun validTopSpeedKmh(value: Any?): Double? =
  (value as? Number)
    ?.toDouble()
    ?.takeIf { it.isFinite() }
    ?.coerceIn(5.0, 150.0)

/** Watch push rate in Hz; 1 Hz floor, 20 Hz ceiling (the 50 ms the wrist link can still keep up with). */
internal fun validWearPushRateHz(value: Any?): Int? =
  (value as? Number)
    ?.toInt()
    ?.coerceIn(1, 20)

val DEFAULT_HISTORY_METRIC_HOT_RANGES: Map<String, Map<String, Double>> = mapOf(
  "speed" to mapOf("start" to 30.0, "end" to 40.0),
  "duty" to mapOf("start" to 60.0, "end" to 80.0),
  "tempMotor" to mapOf("start" to 70.0, "end" to 90.0),
  "tempController" to mapOf("start" to 60.0, "end" to 80.0),
  "motorCurrent" to mapOf("start" to 35.0, "end" to 55.0),
  "batteryCurrent" to mapOf("start" to 25.0, "end" to 45.0),
)

private val historyMetricHotRangeKeys = setOf(
  "speed",
  "duty",
  "battery",
  "tempMotor",
  "tempController",
  "motorCurrent",
  "batteryCurrent",
)

private fun validHistoryMetricHotRanges(value: Any?): Map<String, Map<String, Double>>? {
  val entries: Sequence<Pair<String, Any?>> = when (value) {
    is JSONObject -> value.keys().asSequence().map { it to value.opt(it) }
    is Map<*, *> -> value.asSequence().mapNotNull { (key, range) ->
      (key as? String)?.let { it to range }
    }
    else -> return null
  }

  val ranges = mutableMapOf<String, Map<String, Double>>()
  for ((metric, rawRange) in entries) {
    if (metric !in historyMetricHotRangeKeys) continue
    val start: Double?
    val end: Double?
    when (rawRange) {
      is JSONObject -> {
        start = (rawRange.opt("start") as? Number)?.toDouble()
        end = (rawRange.opt("end") as? Number)?.toDouble()
      }
      is Map<*, *> -> {
        start = (rawRange["start"] as? Number)?.toDouble()
        end = (rawRange["end"] as? Number)?.toDouble()
      }
      else -> continue
    }
    if (start != null && end != null && start.isFinite() && end.isFinite() && start != end) {
      ranges[metric] = mapOf("start" to start, "end" to end)
    }
  }
  return ranges
}

private fun Any?.asStringKeyMap(): Map<String, Any?>? = when (this) {
  is JSONObject -> keys().asSequence().associateWith { key -> opt(key).takeUnless { it == JSONObject.NULL } }
  is Map<*, *> -> entries.associate { (key, value) ->
    (key as? String ?: return null) to value
  }
  else -> null
}

// @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift
class AppDataRepository private constructor(private val context: Context) {
  private val dao = TelemetryDatabase.get(context).telemetryDao()

  /** Notify JS that persisted data in [scope] changed, so the matching store reloads and stays in
   *  sync without an app restart. Every mutating method below funnels through here — new writes get
   *  sync for free by tagging the right scope. Idempotent on the JS side, so emitting after a
   *  JS-initiated write is harmless (the reload just confirms native truth). */
  private fun notifyDataChanged(scope: AppDataScope) {
    CoreForegroundService.emitEvent?.invoke("onAppDataChanged", mapOf("scope" to scope.wire))
  }

  suspend fun getBoards(): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    val boards = dao.getBoards()
    val settingsByBoard =
      if (boards.isEmpty()) emptyMap() else dao.getBoardSettings(boards.map { it.id }).groupBy { it.boardId }
    boards.map { it.toMap(settingsByBoard[it.id].orEmpty()) }
  }

  suspend fun getBoard(id: String): Map<String, Any?>? = withContext(Dispatchers.IO) {
    dao.getBoard(id)?.toMap(dao.getBoardSettings(id))
  }

  suspend fun upsertBoard(board: Map<String, Any?>): Unit = withContext(Dispatchers.IO) {
    val boardId = board.getString("id")
    val (settings, deletedKeys) = board.toBoardSettingEntities(boardId)
    dao.upsertBoardWithSettings(board.toBoardEntity(), settings, deletedKeys)
    notifyDataChanged(AppDataScope.BOARDS)
  }

  suspend fun deleteBoard(id: String): Unit = withContext(Dispatchers.IO) {
    dao.deleteBoardWithSettings(id)
    dao.deleteBoardConfigValues(id)
    dao.deleteBoardConfigChangeNotice(id)
    notifyDataChanged(AppDataScope.BOARDS)
  }

  /**
   * Last Known Board Config Values for this Board + Refloat base version — displayable, never a
   * write base (ADR 0035). Null when none exist for that scope.
   * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `load`
   */
  internal suspend fun getBoardConfigValues(boardId: String, refloatBaseVersion: String): BoardConfigValues? =
    withContext(Dispatchers.IO) {
      if (boardId.isBlank() || refloatBaseVersion.isBlank()) return@withContext null
      val row = dao.getBoardConfigValues(boardId, refloatBaseVersion) ?: return@withContext null
      BoardConfigValues.lastKnown(
        boardId = boardId,
        refloatBaseVersion = refloatBaseVersion,
        capturedAtMs = row.capturedAt,
        valuesJson = row.valuesJson,
      )
    }

  /**
   * The most recently captured Last Known scope for a Board, whichever Refloat base version it was
   * read against.
   *
   * For readers with no Board Session to tell them the base version — a screen opened while the
   * Board is off. Displayable only, exactly like [getBoardConfigValues]: the newest row is the last
   * thing Vescape saw on that Board, and picking a scope is meaningless without a connection to say
   * which firmware is running now.
   * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `loadLatest`
   */
  internal suspend fun getLatestBoardConfigValues(boardId: String): BoardConfigValues? =
    withContext(Dispatchers.IO) {
      if (boardId.isBlank()) return@withContext null
      val row = dao.getLatestBoardConfigValues(boardId) ?: return@withContext null
      BoardConfigValues.lastKnown(
        boardId = boardId,
        refloatBaseVersion = row.refloatBaseVersion,
        capturedAtMs = row.capturedAt,
        valuesJson = row.valuesJson,
      )
    }

  /**
   * Persist values just read from the board. Values need both Board and Tune Compatibility scope.
   * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `save`
   */
  internal suspend fun saveBoardConfigValues(values: BoardConfigValues): Unit = withContext(Dispatchers.IO) {
    val boardId = values.boardId?.takeIf { it.isNotBlank() } ?: return@withContext
    val refloatBaseVersion = values.refloatBaseVersion?.takeIf { it.isNotBlank() } ?: return@withContext
    dao.upsertBoardConfigValues(
      BoardConfigValuesEntity(
        boardId = boardId,
        refloatBaseVersion = refloatBaseVersion,
        valuesJson = values.valuesJson(),
        capturedAt = values.capturedAtMs,
      ),
    )
  }

  internal suspend fun saveFreshBoardConfigValues(values: BoardConfigValues): BoardConfigChangeNotice? = withContext(Dispatchers.IO) {
    val boardId = values.boardId ?: return@withContext null
    val base = values.refloatBaseVersion ?: return@withContext null
    val row = dao.replaceBaselineAndNotice(BoardConfigValuesEntity(boardId, base, values.valuesJson(), values.capturedAtMs)) { old ->
      val oldValues = old?.let { BoardConfigValues.lastKnown(boardId, base, it.capturedAt, it.valuesJson).values } ?: return@replaceBaselineAndNotice null
      val diffs = BoardConfigChangeNotice.diff(oldValues, values.values, values.writeBase?.schema)
      diffs.takeIf { it.isNotEmpty() }?.let { BoardConfigChangeNoticeEntity(boardId, values.capturedAtMs, BoardConfigChangeNotice(boardId, values.capturedAtMs, it).diffsJson()) }
    }
    row?.let { BoardConfigChangeNotice.from(it.boardId, it.detectedAt, it.diffsJson) }
  }

  internal suspend fun getBoardConfigChangeNotice(boardId: String): BoardConfigChangeNotice? = withContext(Dispatchers.IO) {
    dao.getBoardConfigChangeNotice(boardId)?.let { BoardConfigChangeNotice.from(it.boardId, it.detectedAt, it.diffsJson) }
  }

  suspend fun dismissBoardConfigChangeNotice(boardId: String) = withContext(Dispatchers.IO) {
    dao.deleteBoardConfigChangeNotice(boardId)
    CoreForegroundService.emitEvent?.invoke("onBoardConfigChangeNotice", mapOf("notice" to null))
  }

  /**
   * The Board's most recently captured Motor Config Values, whatever signature they were read
   * under. Restored as `lastKnown`; the caller drops them if the live board turns out to answer
   * with a different signature.
   * @parity /modules/vescape-core/ios/config/MotorConfigStore.swift `latest`
   */
  internal suspend fun getLatestMotorConfigValues(boardId: String): MotorConfigValues? =
    withContext(Dispatchers.IO) {
      if (boardId.isBlank()) return@withContext null
      val row = dao.getLatestMotorConfigValues(boardId) ?: return@withContext null
      MotorConfigValues.lastKnown(
        boardId = boardId,
        signature = row.mcconfSignature,
        firmware = row.firmware,
        capturedAtMs = row.capturedAt,
        valuesJson = row.valuesJson,
      )
    }

  /**
   * A freshly decoded motor config: compare against the Board's last stored motor values, then merge
   * any differences into the Board's change notice and replace the baseline in one transaction.
   *
   * No previous row means first read — a baseline, never a notice. Values read under a *different*
   * signature are not compared either: a firmware update rewrites the layout wholesale, and every
   * field would diff.
   * @parity /modules/vescape-core/ios/config/MotorConfigStore.swift `saveFresh`
   */
  internal suspend fun saveFreshMotorConfigValues(values: MotorConfigValues): BoardConfigChangeNotice? =
    withContext(Dispatchers.IO) {
      val boardId = values.boardId?.takeIf { it.isNotBlank() } ?: return@withContext null
      val entity = MotorConfigValuesEntity(
        boardId = boardId,
        mcconfSignature = values.signature,
        firmware = values.firmware,
        valuesJson = values.valuesJson(),
        capturedAt = values.capturedAtMs,
      )
      val row = dao.replaceMotorBaselineAndNotice(entity) { old, existingNotice ->
        if (old == null || old.mcconfSignature != values.signature) return@replaceMotorBaselineAndNotice existingNotice
        val oldValues = MotorConfigValues.lastKnown(
          boardId = boardId,
          signature = old.mcconfSignature,
          firmware = old.firmware,
          capturedAtMs = old.capturedAt,
          valuesJson = old.valuesJson,
        ).values
        // Motor config carries no schema, so a field's id is its own label (ADR 0036).
        val diffs = BoardConfigChangeNotice.diff(oldValues, values.values, null)
        if (diffs.isEmpty()) return@replaceMotorBaselineAndNotice existingNotice
        val previous = existingNotice
          ?.let { BoardConfigChangeNotice.from(it.boardId, it.detectedAt, it.diffsJson)?.diffs }
          .orEmpty()
        val merged = BoardConfigChangeNotice.mergeDiffs(previous, diffs)
        BoardConfigChangeNoticeEntity(
          boardId,
          values.capturedAtMs,
          BoardConfigChangeNotice(boardId, values.capturedAtMs, merged).diffsJson(),
        )
      }
      row?.let { BoardConfigChangeNotice.from(it.boardId, it.detectedAt, it.diffsJson) }
    }

  /**
   * Drop every Last Known scope for a Board. Called when link integrity goes `mismatched`: the firmware
   * behind the link is not the one those offsets were decoded against.
   * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `clear`
   */
  internal suspend fun clearBoardConfigValues(boardId: String): Unit = withContext(Dispatchers.IO) {
    if (boardId.isBlank()) return@withContext
    dao.deleteBoardConfigValues(boardId)
    dao.deleteBoardConfigChangeNotice(boardId)
    dao.deleteMotorConfigValues(boardId)
  }

  suspend fun getAlertRules(boardId: String): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    dao.getAlertRules(boardId).map { it.toMap() }
  }

  /** The given Board's enabled rules — the alert engine evaluates only the connected Board's rules. */
  suspend fun getEnabledAlertRuleEntities(boardId: String): List<AlertRuleEntity> =
    withContext(Dispatchers.IO) {
      dao.getEnabledAlertRules(boardId)
    }

  suspend fun upsertAlertRule(rule: Map<String, Any?>): Unit = withContext(Dispatchers.IO) {
    dao.upsertAlertRule(rule.toAlertRuleEntity())
  }

  suspend fun setAlertRuleEnabled(boardId: String, id: String, enabled: Boolean): Unit =
    withContext(Dispatchers.IO) {
      dao.setAlertRuleEnabled(boardId, id, enabled)
    }

  suspend fun deleteAlertRule(boardId: String, id: String): Unit = withContext(Dispatchers.IO) {
    dao.deleteAlertRule(boardId, id)
  }

  suspend fun getSettings(): Map<String, Any?> = withContext(Dispatchers.IO) {
    getTypedSettings().toMap()
  }

  suspend fun getTypedSettings(): AppSettings = withContext(Dispatchers.IO) {
    val rows = dao.getAllAppSettings()
    val map = rows.associateBy { it.key }
    val badKeys = mutableListOf<String>()

    fun <T : Any> req(key: String, default: T, coerce: (Any?) -> T?): T {
      val row = map[key] ?: return default
      return try {
        coerce(decodeSettingJson(row.valueJson)) ?: run { badKeys += key; default }
      } catch (_: Exception) { badKeys += key; default }
    }

    fun <T : Any> opt(key: String, coerce: (Any) -> T?): T? {
      val row = map[key] ?: return null
      return try {
        val raw = decodeSettingJson(row.valueJson) ?: return null
        coerce(raw) ?: run { badKeys += key; null }
      } catch (_: Exception) { badKeys += key; null }
    }

    val settings = AppSettings(
      liveHistoryLimit = req("liveHistoryLimit", 5, ::validLiveHistoryLimitMinutes),
      autoConnect = req("autoConnect", true) { it as? Boolean },
      autoRecording = req("autoRecording", true) { it as? Boolean },
      selectedBoardId = opt("selectedBoardId") { it as? String },
      lastGpsLatitude = opt("lastGpsLatitude") { (it as? Number)?.toDouble() },
      lastGpsLongitude = opt("lastGpsLongitude") { (it as? Number)?.toDouble() },
      directionPointLatitude = opt(DIRECTION_POINT_LATITUDE) { (it as? Number)?.toDouble() },
      directionPointLongitude = opt(DIRECTION_POINT_LONGITUDE) { (it as? Number)?.toDouble() },
      movingSpeedThresholdKmh = req("movingSpeedThresholdKmh", 3.0) { (it as? Number)?.toDouble() },
      freeSpinMaxSpeedDeltaKmh = req("freeSpinMaxSpeedDeltaKmh", DEFAULT_FREE_SPIN_MAX_SPEED_DELTA_KMH) { (it as? Number)?.toDouble() },
      freeSpinStationaryBoardCapKmh = req("freeSpinStationaryBoardCapKmh", DEFAULT_FREE_SPIN_STATIONARY_BOARD_CAP_KMH) { (it as? Number)?.toDouble() },
      themeMode = req("themeMode", "system", ::validThemeMode),
      mapStyleKey = req("mapStyleKey", "onedark", ::validMapStyleKey),
      satelliteOverlayEnabled = req("satelliteOverlayEnabled", true) { it as? Boolean },
      satelliteImageryOpacity = req("satelliteImageryOpacity", 0.2, ::validSatelliteImageryOpacity),
      satelliteMapImageryOpacity = req("satelliteMapImageryOpacity", 1.0, ::validSatelliteImageryOpacity),
      satelliteImagerySaturation = req("satelliteImagerySaturation", -0.35, ::validSatelliteImagerySaturation),
      hideTelemetryMapDetails = req("hideTelemetryMapDetails", true) { it as? Boolean },
      mapOrientationMode = req("mapOrientationMode", "northUp", ::validMapOrientationMode),
      historyMetricGradientsEnabled = req("historyMetricGradientsEnabled", true) { it as? Boolean },
      historyMetricHotRanges = req("historyMetricHotRanges", DEFAULT_HISTORY_METRIC_HOT_RANGES, ::validHistoryMetricHotRanges),
      socEstimateWindowSeconds = req("socEstimateWindowSeconds", 20, ::validSocEstimateWindowSeconds),
      boardMoveStrengthPercent = req("boardMoveStrengthPercent", 60, ::validBoardMoveStrengthPercent),
      connectionSoundsEnabled = req("connectionSoundsEnabled", true) { it as? Boolean },
      telemetryPollRateHz = req("telemetryPollRateHz", 20, ::validTelemetryPollRateHz),
      wearPushRateHz = req("wearPushRateHz", 4, ::validWearPushRateHz),
      wearAutoLaunchOnConnect = req("wearAutoLaunchOnConnect", true) { it as? Boolean },
      wearNavArrowEnabled = req("wearNavArrowEnabled", false) { it as? Boolean },
      companionPresenceEnabled = req("companionPresenceEnabled", false) { it as? Boolean },
      boardWarningsEnabled = req("boardWarningsEnabled", true) { it as? Boolean },
      vescFaultCollectionEnabled = req("vescFaultCollectionEnabled", true) { it as? Boolean },
      companionPresenceCooldownMinutes = req("companionPresenceCooldownMinutes", 60, ::validCompanionCooldownMinutes),
      autoCloseEnabled = req("autoCloseEnabled", false) { it as? Boolean },
      autoCloseDelayMinutes = req("autoCloseDelayMinutes", 15, ::validAutoCloseDelayMinutes),
      rideSplitGapMinutes = req(
        "rideSplitGapMinutes",
        DEFAULT_RIDE_SPLIT_GAP_MINUTES,
        ::validRideSplitGapMinutes,
      ),
      riderId = opt("riderId") { it as? String },
      riderName = opt("riderName") { it as? String },
      riderColor = opt("riderColor") { it as? String },
      legalPolicy = opt("legalPolicy", ::normalizeLegalPolicy),
      dismissedCommunityMessageIds =
        req("dismissedCommunityMessageIds", emptyList(), ::validDismissedCommunityMessageIds),
    )

    if (badKeys.isNotEmpty()) {
      for (key in badKeys) dao.deleteAppSetting(key)
      DiagnosticReporter.get(context).capture(
        "app_setting_corrupt",
        mapOf("keys" to badKeys.joinToString(",")),
      )
    }

    if (settings.companionPresenceEnabled && !settings.autoConnect) {
      dao.upsertAppSetting(
        AppSettingEntity(
          key = "autoConnect",
          valueJson = encodeSettingJson(true),
          updatedAt = System.currentTimeMillis(),
        ),
      )
      return@withContext settings.copy(autoConnect = true)
    }

    settings
  }

  suspend fun updateSetting(key: String, value: Any?): Unit = withContext(Dispatchers.IO) {
    val coerced: Any? = when (key) {
      "liveHistoryLimit" -> validLiveHistoryLimitMinutes(value) ?: return@withContext
      "autoConnect" -> value as? Boolean ?: return@withContext
      "autoRecording" -> value as? Boolean ?: return@withContext
      "selectedBoardId" -> value as? String
      "lastGpsLatitude" -> (value as? Number)?.toDouble()
      "lastGpsLongitude" -> (value as? Number)?.toDouble()
      "movingSpeedThresholdKmh", "avgSpeedCutoffKmh", "movingAvgSpeedThresholdKmh" ->
        ((value as? Number)?.toDouble() ?: return@withContext).coerceAtLeast(0.0)
      "freeSpinMaxSpeedDeltaKmh", "freeSpinStationaryBoardCapKmh" ->
        ((value as? Number)?.toDouble() ?: return@withContext).coerceAtLeast(0.0)
      "themeMode" -> validThemeMode(value) ?: return@withContext
      "mapStyleKey" ->
        validMapStyleKey(value) ?: return@withContext
      "satelliteOverlayEnabled" -> value as? Boolean ?: return@withContext
      "satelliteImageryOpacity" ->
        validSatelliteImageryOpacity(value) ?: return@withContext
      "satelliteMapImageryOpacity" ->
        validSatelliteImageryOpacity(value) ?: return@withContext
      "satelliteImagerySaturation" ->
        validSatelliteImagerySaturation(value) ?: return@withContext
      "hideTelemetryMapDetails" -> value as? Boolean ?: return@withContext
      "mapOrientationMode" ->
        validMapOrientationMode(value) ?: return@withContext
      "historyMetricGradientsEnabled" -> value as? Boolean ?: return@withContext
      "historyMetricHotRanges" ->
        validHistoryMetricHotRanges(value) ?: return@withContext
      "socEstimateWindowSeconds" ->
        validSocEstimateWindowSeconds(value) ?: return@withContext
      "boardMoveStrengthPercent" ->
        validBoardMoveStrengthPercent(value) ?: return@withContext
      "connectionSoundsEnabled" -> value as? Boolean ?: return@withContext
      "telemetryPollRateHz" ->
        validTelemetryPollRateHz(value) ?: return@withContext
      "wearPushRateHz" ->
        validWearPushRateHz(value) ?: return@withContext
      "wearAutoLaunchOnConnect" -> value as? Boolean ?: return@withContext
      "wearNavArrowEnabled" -> value as? Boolean ?: return@withContext
      "companionPresenceEnabled" -> value as? Boolean ?: return@withContext
      "boardWarningsEnabled" -> value as? Boolean ?: return@withContext
      "vescFaultCollectionEnabled" -> value as? Boolean ?: return@withContext
      "companionPresenceCooldownMinutes" ->
        validCompanionCooldownMinutes(value) ?: return@withContext
      "autoCloseEnabled" -> value as? Boolean ?: return@withContext
      "autoCloseDelayMinutes" ->
        validAutoCloseDelayMinutes(value) ?: return@withContext
      "rideSplitGapMinutes" ->
        validRideSplitGapMinutes(value) ?: return@withContext
      "riderId", "riderName", "riderColor" -> value as? String
      // Legal Policy is native-owned. JS can request refresh through the dedicated intent.
      "legalPolicy" -> return@withContext
      "dismissedCommunityMessageIds" ->
        if (value == null || value == JSONObject.NULL) emptyList()
        else validDismissedCommunityMessageIds(value) ?: return@withContext
      else -> return@withContext
    }
    val normalizedKey = when (key) {
      "avgSpeedCutoffKmh", "movingAvgSpeedThresholdKmh" -> "movingSpeedThresholdKmh"
      else -> key
    }
    if (normalizedKey == "autoConnect" && coerced == false && getTypedSettings().companionPresenceEnabled) {
      return@withContext
    }
    val default: Any? = AppSettings().let { d ->
      when (normalizedKey) {
        "liveHistoryLimit" -> d.liveHistoryLimit
        "autoConnect" -> d.autoConnect
        "autoRecording" -> d.autoRecording
        "selectedBoardId" -> d.selectedBoardId
        "lastGpsLatitude" -> d.lastGpsLatitude
        "lastGpsLongitude" -> d.lastGpsLongitude
        "movingSpeedThresholdKmh" -> d.movingSpeedThresholdKmh
        "freeSpinMaxSpeedDeltaKmh" -> d.freeSpinMaxSpeedDeltaKmh
        "freeSpinStationaryBoardCapKmh" -> d.freeSpinStationaryBoardCapKmh
        "themeMode" -> d.themeMode
        "mapStyleKey" -> d.mapStyleKey
        "satelliteOverlayEnabled" -> d.satelliteOverlayEnabled
        "satelliteImageryOpacity" -> d.satelliteImageryOpacity
        "satelliteMapImageryOpacity" -> d.satelliteMapImageryOpacity
        "satelliteImagerySaturation" -> d.satelliteImagerySaturation
        "hideTelemetryMapDetails" -> d.hideTelemetryMapDetails
        "mapOrientationMode" -> d.mapOrientationMode
        "historyMetricGradientsEnabled" -> d.historyMetricGradientsEnabled
        "historyMetricHotRanges" -> d.historyMetricHotRanges
        "socEstimateWindowSeconds" -> d.socEstimateWindowSeconds
        "boardMoveStrengthPercent" -> d.boardMoveStrengthPercent
        "connectionSoundsEnabled" -> d.connectionSoundsEnabled
        "telemetryPollRateHz" -> d.telemetryPollRateHz
        "wearPushRateHz" -> d.wearPushRateHz
        "wearAutoLaunchOnConnect" -> d.wearAutoLaunchOnConnect
        "wearNavArrowEnabled" -> d.wearNavArrowEnabled
        "companionPresenceEnabled" -> d.companionPresenceEnabled
        "boardWarningsEnabled" -> d.boardWarningsEnabled
        "vescFaultCollectionEnabled" -> d.vescFaultCollectionEnabled
        "companionPresenceCooldownMinutes" -> d.companionPresenceCooldownMinutes
        "autoCloseEnabled" -> d.autoCloseEnabled
        "autoCloseDelayMinutes" -> d.autoCloseDelayMinutes
        "rideSplitGapMinutes" -> d.rideSplitGapMinutes
        "riderId" -> d.riderId
        "riderName" -> d.riderName
        "riderColor" -> d.riderColor
        "legalPolicy" -> d.legalPolicy
        "dismissedCommunityMessageIds" -> d.dismissedCommunityMessageIds
        else -> null
      }
    }
    if (coerced == default) {
      dao.deleteAppSetting(normalizedKey)
    } else {
      dao.upsertAppSetting(
        AppSettingEntity(
          key = normalizedKey,
          valueJson = encodeSettingJson(coerced),
          updatedAt = System.currentTimeMillis(),
        ),
      )
    }
    notifyDataChanged(AppDataScope.SETTINGS)
  }

  suspend fun updateLastGpsLocation(latitude: Double, longitude: Double): Unit = withContext(Dispatchers.IO) {
    val now = System.currentTimeMillis()
    dao.upsertAppSetting(AppSettingEntity("lastGpsLatitude", encodeSettingJson(latitude), now))
    dao.upsertAppSetting(AppSettingEntity("lastGpsLongitude", encodeSettingJson(longitude), now))
    notifyDataChanged(AppDataScope.SETTINGS)
  }

  /**
   * Persist only the resolved jurisdiction reference; policy values stay in the shared catalog.
   *
   * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `updateLegalPolicy`
   */
  suspend fun updateLegalPolicy(jurisdictionCode: String?): Unit = withContext(Dispatchers.IO) {
    val normalized = jurisdictionCode?.trim()?.uppercase()?.takeIf { it.length == 2 }
    if (normalized == null) {
      dao.deleteAppSetting("legalPolicy")
    } else {
      dao.upsertAppSetting(
        AppSettingEntity(
          key = "legalPolicy",
          valueJson = encodeSettingJson(mapOf("jurisdictionCode" to normalized)),
          updatedAt = System.currentTimeMillis(),
        ),
      )
    }
    notifyDataChanged(AppDataScope.SETTINGS)
  }

  suspend fun setSelectedBoardId(id: String?): Unit = updateSetting("selectedBoardId", id)

  suspend fun updateLastBattery(
    boardId: String,
    percent: Double,
    voltage: Double?,
    atMs: Long,
  ): Unit = withContext(Dispatchers.IO) {
    val value = mapOf("percent" to percent, "voltage" to voltage, "at" to atMs)
    dao.upsertBoardSetting(BoardSettingEntity(boardId, "lastBattery", encodeSettingJson(value), atMs))
    notifyDataChanged(AppDataScope.BOARDS)
  }

  /**
   * Dedicated native Legal Mode write; generic Board upserts cannot bypass enable validation.
   * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `updateLegalMode`
   */
  suspend fun updateLegalMode(boardId: String, enabled: Boolean): Unit = withContext(Dispatchers.IO) {
    dao.upsertBoardSetting(
      BoardSettingEntity(
        boardId = boardId,
        key = "legalMode",
        valueJson = encodeSettingJson(mapOf("enabled" to enabled)),
        updatedAt = System.currentTimeMillis(),
      ),
    )
    notifyDataChanged(AppDataScope.BOARDS)
  }

  // Tune Profiles: per-board VESC tune configs with reversible Tune History.
  // @parity /modules/vescape-core/ios/telemetry/TuneProfileStore.swift
  suspend fun getTuneProfiles(boardId: String, refloatBaseVersion: String?): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    val compatibility = validRefloatBaseVersion(refloatBaseVersion) ?: return@withContext emptyList()
    dao.getTuneProfilesByBoard(boardId, compatibility).map { it.toMap() }
  }

  suspend fun getTuneProfile(id: String): Map<String, Any?>? = withContext(Dispatchers.IO) {
    dao.getTuneProfile(id)?.toMap()
  }

  suspend fun createProfile(
    boardId: String,
    name: String,
    icon: String,
    color: String,
    fields: Map<String, Any?>,
    refloatBaseVersion: String,
  ): Map<String, Any?> =
    withContext(Dispatchers.IO) {
      val compatibility = validRefloatBaseVersion(refloatBaseVersion)
        ?: throw IllegalArgumentException("Missing Refloat Tune Compatibility")
      val now = System.currentTimeMillis()
      val fieldsJson = fields.toJsonObject().toString()
      val profile = TuneProfileEntity(
        id = UUID.randomUUID().toString(),
        boardId = boardId,
        refloatBaseVersion = compatibility,
        name = name,
        icon = icon,
        color = color,
        fieldsJson = fieldsJson,
        createdAt = now,
        updatedAt = now,
      )
      dao.upsertTuneProfile(profile)
      dao.insertTuneHistoryEntry(
        TuneHistoryEntryEntity(
          profileId = profile.id,
          fieldsJson = fieldsJson,
          createdAt = now,
        ),
      )
      profile.toMap()
    }

  suspend fun renameProfile(
    profileId: String,
    name: String,
    icon: String,
    color: String,
  ): Map<String, Any?> =
    withContext(Dispatchers.IO) {
      dao.updateProfileMetadata(profileId, name, icon, color, System.currentTimeMillis())
      dao.getTuneProfile(profileId)?.toMap()
        ?: throw IllegalArgumentException("Tune Profile not found: $profileId")
    }

  suspend fun deleteProfile(profileId: String): Unit = withContext(Dispatchers.IO) {
    dao.deleteTuneProfileSafe(profileId)
  }

  suspend fun getProfileHistory(profileId: String): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    dao.getTuneHistoryEntries(profileId).map { it.toMap() }
  }

  suspend fun rollbackProfile(profileId: String, historyEntryId: Long): Map<String, Any?> =
    withContext(Dispatchers.IO) {
      dao.rollbackTuneProfile(profileId, historyEntryId).toMap()
    }

  suspend fun copyProfileToBoard(profileId: String, targetBoardId: String, newName: String): Map<String, Any?> =
    withContext(Dispatchers.IO) {
      val source = dao.getTuneProfile(profileId)
        ?: throw IllegalArgumentException("Source profile not found: $profileId")
      val now = System.currentTimeMillis()
      val copy = TuneProfileEntity(
        id = UUID.randomUUID().toString(),
        boardId = targetBoardId,
        refloatBaseVersion = source.refloatBaseVersion,
        name = newName,
        icon = source.icon,
        color = source.color,
        fieldsJson = source.fieldsJson,
        createdAt = now,
        updatedAt = now,
      )
      dao.upsertTuneProfile(copy)
      dao.insertTuneHistoryEntry(
        TuneHistoryEntryEntity(
          profileId = copy.id,
          fieldsJson = copy.fieldsJson,
          createdAt = now,
        ),
      )
      copy.toMap()
    }

  suspend fun saveProfile(profileId: String, fields: Map<String, Any?>): Map<String, Any?> =
    withContext(Dispatchers.IO) {
      dao.saveTuneProfile(
        profileId = profileId,
        fieldsJson = fields.toJsonObject().toString(),
        updatedAt = System.currentTimeMillis(),
      ).toMap()
    }

  suspend fun getPrivacyZones(): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    dao.getPrivacyZones().map { it.toMap() }
  }

  suspend fun getEnabledPrivacyZoneEntities(): List<PrivacyZoneEntity> = withContext(Dispatchers.IO) {
    dao.getEnabledPrivacyZones()
  }

  suspend fun upsertPrivacyZone(zone: Map<String, Any?>): Unit = withContext(Dispatchers.IO) {
    dao.upsertPrivacyZone(zone.toPrivacyZoneEntity())
  }

  suspend fun setPrivacyZoneEnabled(id: String, enabled: Boolean): Unit = withContext(Dispatchers.IO) {
    dao.setPrivacyZoneEnabled(id, enabled, System.currentTimeMillis())
  }

  suspend fun deletePrivacyZone(id: String): Unit = withContext(Dispatchers.IO) {
    dao.deletePrivacyZone(id)
  }

  /**
   * The personal direction target. Not a Map Point: it is never shared, and Group Ride presence
   * reads it natively while JS is gone.
   *
   * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `directionPoint`
   */
  suspend fun getDirectionPoint(): Pair<Double, Double>? = withContext(Dispatchers.IO) {
    val settings = getTypedSettings()
    val latitude = settings.directionPointLatitude
    val longitude = settings.directionPointLongitude
    if (latitude == null || longitude == null) null else latitude to longitude
  }

  suspend fun setDirectionPoint(latitude: Double?, longitude: Double?): Unit =
    withContext(Dispatchers.IO) {
      val now = System.currentTimeMillis()
      dao.upsertAppSetting(
        AppSettingEntity(DIRECTION_POINT_LATITUDE, encodeSettingJson(latitude), now),
      )
      dao.upsertAppSetting(
        AppSettingEntity(DIRECTION_POINT_LONGITUDE, encodeSettingJson(longitude), now),
      )
      notifyDataChanged(AppDataScope.SETTINGS)
    }

  /**
   * The rider's stored Navigation, as the opaque JSON its own codec writes. Deliberately not part of
   * the settings projection: it is native-owned, JS receives it through `onNavigation` instead, and
   * it is by far the largest value here (~14 KB for a long path) so it must not ride along on every
   * settings read.
   *
   * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `navigationPath`
   */
  suspend fun getNavigationPath(): String? = withContext(Dispatchers.IO) {
    dao.getAppSetting(NAVIGATION_PATH)?.valueJson?.let { decodeSettingJson(it) as? String }
  }

  suspend fun setNavigationPath(json: String?): Unit = withContext(Dispatchers.IO) {
    if (json == null) {
      dao.deleteAppSetting(NAVIGATION_PATH)
    } else {
      dao.upsertAppSetting(
        AppSettingEntity(NAVIGATION_PATH, encodeSettingJson(json), System.currentTimeMillis()),
      )
    }
  }

  /**
   * The rider's last chosen Navigation Profile, as its wire string. App data rather than a
   * user-facing setting: nothing in the settings UI shows it, the rider only ever moves it by
   * switching profile while looking at a path.
   *
   * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `navigationProfile`
   */
  suspend fun getNavigationProfile(): String? = withContext(Dispatchers.IO) {
    dao.getAppSetting(NAVIGATION_PROFILE)?.valueJson?.let { decodeSettingJson(it) as? String }
  }

  suspend fun setNavigationProfile(profile: String): Unit = withContext(Dispatchers.IO) {
    dao.upsertAppSetting(
      AppSettingEntity(NAVIGATION_PROFILE, encodeSettingJson(profile), System.currentTimeMillis()),
    )
  }

  suspend fun getAutoConnectBoard(): Map<String, Any?>? = withContext(Dispatchers.IO) {
    val settings = getTypedSettings()
    settings.selectedBoardId
      ?.let { dao.getBoard(it) }
      ?.let { it.toMap(dao.getBoardSettings(it.id)) }
      ?: dao.getBoards().firstOrNull()?.let { it.toMap(dao.getBoardSettings(it.id)) }
  }

  companion object {
    @Volatile
    private var instance: AppDataRepository? = null

    fun get(context: Context): AppDataRepository {
      return instance ?: synchronized(this) {
        instance ?: AppDataRepository(context.applicationContext).also { instance = it }
      }
    }

    fun resetForDatabaseSwap() {
      synchronized(this) {
        instance = null
      }
    }
  }
}

private const val BOARD_LINK_VERSION = 4
private val boardLinkStringIdentityKeys = listOf(
  "vescFirmwareVersion",
  "refloatVersion",
  "refloatBaseVersion",
)

// @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `composeBoard` / `upsertBoard`
fun BoardEntity.toMap(settings: List<BoardSettingEntity>): Map<String, Any?> {
  val values = settings.mapNotNull { it.decodeBoardSetting() }.toMap()
  // A Board Link exists only when both a BLE peripheral and a proven transport
  // are stored; a partial bleId-without-transport row reads as unlinked.
  val transport = values["transport"]
  val link = if (bleId != null && transport != null) {
    buildMap<String, Any?> {
      put("bleId", bleId)
      put("transport", transport)
      // Only the current schema version survives the read. A missing or older stored version
      // reads as absent so the link registers as legacy and re-probes, instead of being laundered
      // into a current-looking link by a default.
      (values["linkVersion"] as? Int)?.takeIf { it == BOARD_LINK_VERSION }?.let { put("linkVersion", it) }
      (values["hasBms"] as? Boolean)?.let { put("hasBms", it) }
      boardLinkStringIdentityKeys.forEach { key ->
        (values[key] as? String)?.let { put(key, it) }
      }
    }
  } else {
    null
  }
  return mapOf(
    "id" to id,
    "name" to name,
    "description" to values["description"],
    "createdAt" to createdAt,
    "batteryConfig" to values["batteryConfig"],
    "lastBattery" to values["lastBattery"],
    "dismissedWarnings" to values["dismissedWarnings"],
    // Alert Preset board settings, normalized to display defaults when the row is absent so JS
    // always reads a concrete Board Top Speed / onboarded flag. `alertPreset` stays null until the
    // rider touches setup — no preset rules generate before then.
    "topSpeedKmh" to (values["topSpeedKmh"] ?: DEFAULT_TOP_SPEED_KMH),
    "alertPreset" to values["alertPreset"],
    "alertPresetsOnboarded" to (values["alertPresetsOnboarded"] ?: false),
    "matchBoardConfig" to values["matchBoardConfig"],
    "legalMode" to (values["legalMode"] ?: mapOf("enabled" to false)),
    "link" to link,
  )
}

fun AppSettings.toMap(): Map<String, Any?> = mapOf(
  "liveHistoryLimit" to liveHistoryLimit,
  "autoConnect" to autoConnect,
  "autoRecording" to autoRecording,
  "selectedBoardId" to selectedBoardId,
  "lastGpsLatitude" to lastGpsLatitude,
  "lastGpsLongitude" to lastGpsLongitude,
  DIRECTION_POINT_LATITUDE to directionPointLatitude,
  DIRECTION_POINT_LONGITUDE to directionPointLongitude,
  "movingSpeedThresholdKmh" to movingSpeedThresholdKmh,
  "freeSpinMaxSpeedDeltaKmh" to freeSpinMaxSpeedDeltaKmh,
  "freeSpinStationaryBoardCapKmh" to freeSpinStationaryBoardCapKmh,
  "themeMode" to themeMode,
  "mapStyleKey" to mapStyleKey,
  "satelliteOverlayEnabled" to satelliteOverlayEnabled,
  "satelliteImageryOpacity" to satelliteImageryOpacity,
  "satelliteMapImageryOpacity" to satelliteMapImageryOpacity,
  "satelliteImagerySaturation" to satelliteImagerySaturation,
  "hideTelemetryMapDetails" to hideTelemetryMapDetails,
  "mapOrientationMode" to mapOrientationMode,
  "historyMetricGradientsEnabled" to historyMetricGradientsEnabled,
  "historyMetricHotRanges" to historyMetricHotRanges,
  "socEstimateWindowSeconds" to socEstimateWindowSeconds,
  "boardMoveStrengthPercent" to boardMoveStrengthPercent,
  "connectionSoundsEnabled" to connectionSoundsEnabled,
  "telemetryPollRateHz" to telemetryPollRateHz,
  "wearPushRateHz" to wearPushRateHz,
  "wearAutoLaunchOnConnect" to wearAutoLaunchOnConnect,
  "wearNavArrowEnabled" to wearNavArrowEnabled,
  "companionPresenceEnabled" to companionPresenceEnabled,
  "boardWarningsEnabled" to boardWarningsEnabled,
  "vescFaultCollectionEnabled" to vescFaultCollectionEnabled,
  "companionPresenceCooldownMinutes" to companionPresenceCooldownMinutes,
  "autoCloseEnabled" to autoCloseEnabled,
  "autoCloseDelayMinutes" to autoCloseDelayMinutes,
  "rideSplitGapMinutes" to rideSplitGapMinutes,
  "riderId" to riderId,
  "riderName" to riderName,
  "riderColor" to riderColor,
  "legalPolicy" to legalPolicy,
  "dismissedCommunityMessageIds" to dismissedCommunityMessageIds,
)

private fun normalizeLegalPolicy(raw: Any): Map<String, String>? {
  val code = (raw.asStringKeyMap()?.get("jurisdictionCode") as? String)
    ?.trim()
    ?.uppercase()
    ?.takeIf { it.length == 2 }
    ?: return null
  return mapOf("jurisdictionCode" to code)
}

internal fun encodeSettingJson(value: Any?): String {
  val arr = JSONArray()
  arr.put(jsonCompatibleValue(value))
  val s = arr.toString()
  return s.substring(1, s.length - 1)
}

internal fun decodeSettingJson(json: String): Any? {
  val obj = JSONObject("{\"v\":$json}")
  val v = obj.get("v")
  return jsonValue(v)
}

fun AlertRuleEntity.toMap(): Map<String, Any?> = mapOf(
  "boardId" to boardId,
  "id" to id,
  "controlId" to controlId,
  "threshold" to threshold,
  "thresholdMax" to thresholdMax,
  "thresholdRule" to if (thresholdKind == "config-relative") mapOf(
    "kind" to thresholdKind, "fieldId" to configFieldId,
    "thresholdOffset" to thresholdOffset, "thresholdMaxOffset" to thresholdMaxOffset,
  ) else mapOf("kind" to "fixed"),
  "enabled" to enabled,
  "soundType" to soundType,
  "createdAt" to createdAt,
  "repeatEverySeconds" to repeatEverySeconds,
  "beepCount" to beepCount,
  "source" to source,
)

fun TuneProfileEntity.toMap(): Map<String, Any?> = mapOf(
  "id" to id,
  "boardId" to boardId,
  "refloatBaseVersion" to refloatBaseVersion,
  "name" to name,
  "icon" to icon,
  "color" to color,
  "fields" to fieldsJson.toJsonMap(),
  "createdAt" to createdAt,
  "updatedAt" to updatedAt,
)

internal fun validRefloatBaseVersion(value: String?): String? =
  value?.takeIf { it.matches(Regex("""\d+\.\d+(?:\.\d+)?""")) }

fun TuneHistoryEntryEntity.toMap(): Map<String, Any?> = mapOf(
  "id" to id,
  "profileId" to profileId,
  "fields" to fieldsJson.toJsonMap(),
  "createdAt" to createdAt,
)

private fun RefloatConfigSnapshot.fieldsJson(): String {
  val json = JSONObject()
  groups.forEach { group ->
    group.fields.forEach { field ->
      json.put(field.id, field.value)
    }
  }
  return json.toString()
}

private fun Map<String, Any?>.toJsonObject(): JSONObject {
  val json = JSONObject()
  forEach { (key, value) ->
    json.put(key, jsonCompatibleValue(value))
  }
  return json
}

private fun jsonCompatibleValue(value: Any?): Any = when (value) {
  null -> JSONObject.NULL
  is Map<*, *> -> {
    val json = JSONObject()
    value.forEach { (key, item) ->
      if (key is String) json.put(key, jsonCompatibleValue(item))
    }
    json
  }
  is Iterable<*> -> JSONArray().also { arr ->
    value.forEach { arr.put(jsonCompatibleValue(it)) }
  }
  is Array<*> -> JSONArray().also { arr ->
    value.forEach { arr.put(jsonCompatibleValue(it)) }
  }
  else -> value
}

private fun String.toJsonMap(): Map<String, Any?> {
  val json = JSONObject(this)
  val result = mutableMapOf<String, Any?>()
  val keys = json.keys()
  while (keys.hasNext()) {
    val key = keys.next()
    result[key] = jsonValue(json.get(key))
  }
  return result
}

private fun jsonValue(value: Any?): Any? {
  return when (value) {
    JSONObject.NULL -> null
    is JSONObject -> {
      val result = mutableMapOf<String, Any?>()
      val keys = value.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        result[key] = jsonValue(value.get(key))
      }
      result
    }
    is JSONArray -> List(value.length()) { index -> jsonValue(value.get(index)) }
    else -> value
  }
}

fun PrivacyZoneEntity.toMap(): Map<String, Any?> = mapOf(
  "id" to id,
  "preset" to preset,
  "name" to name,
  "enabled" to enabled,
  "centerLatitude" to centerLatitudeE7 / 10_000_000.0,
  "centerLongitude" to centerLongitudeE7 / 10_000_000.0,
  "radiusMeters" to radiusMeters,
  "createdAt" to createdAt,
  "updatedAt" to updatedAt,
)

/**
 * Direction target settings keys. The target is one coordinate, so it rides in app settings rather
 * than a table of its own.
 * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `directionPointLatitudeKey`
 * @parity /modules/vescape-core/src/index.ts `AppSettings`
 */
internal const val DIRECTION_POINT_LATITUDE = "directionPointLatitude"
internal const val DIRECTION_POINT_LONGITUDE = "directionPointLongitude"

/**
 * The stored Navigation, next to the Direction Point it belongs to. Native-owned and outside the
 * settings projection — see `getNavigationPath`.
 * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `navigationPathKey`
 */
internal const val NAVIGATION_PATH = "navigationPath"

/**
 * The rider's sticky Navigation Profile. Native-owned app data outside the settings projection —
 * see `getNavigationProfile`.
 * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `navigationProfileKey`
 */
internal const val NAVIGATION_PROFILE = "navigationProfile"

private fun Map<String, Any?>.toPrivacyZoneEntity(): PrivacyZoneEntity {
  val now = System.currentTimeMillis()
  return PrivacyZoneEntity(
    id = getString("id"),
    preset = get("preset") as? String ?: "custom",
    name = getString("name"),
    enabled = getBoolean("enabled"),
    centerLatitudeE7 = ((getDouble("centerLatitude")) * 10_000_000.0).toInt(),
    centerLongitudeE7 = ((getDouble("centerLongitude")) * 10_000_000.0).toInt(),
    radiusMeters = (get("radiusMeters") as? Number)?.toInt()
      ?: throw IllegalArgumentException("Missing number field: radiusMeters"),
    createdAt = (get("createdAt") as? Number)?.toLong() ?: now,
    updatedAt = (get("updatedAt") as? Number)?.toLong() ?: now,
  )
}

@Suppress("UNCHECKED_CAST")
private fun Map<String, Any?>.boardLink(): Map<String, Any?>? = get("link") as? Map<String, Any?>

private fun Map<String, Any?>.normalizedBoardLink(): Map<String, Any?>? {
  val link = boardLink() ?: return null
  val bleId = (link["bleId"] as? String)?.takeIf { it.isNotBlank() } ?: return null
  val transport = BoardTransport.fromBridge(link["transport"]) ?: return null
  return link + mapOf(
    "bleId" to bleId,
    "transport" to BoardTransport.toBridge(transport),
  )
}

internal fun Map<String, Any?>.toBoardEntity(): BoardEntity = BoardEntity(
  id = getString("id"),
  name = getString("name"),
  bleId = normalizedBoardLink()?.get("bleId") as? String,
  createdAt = getLong("createdAt"),
)

internal fun Map<String, Any?>.toBoardSettingEntities(boardId: String): Pair<List<BoardSettingEntity>, List<String>> {
  val now = System.currentTimeMillis()
  val settings = mutableListOf<BoardSettingEntity>()
  val deletedKeys = mutableListOf<String>()

  fun putOrDelete(key: String, value: Any?) {
    if (value == null) {
      deletedKeys += key
    } else {
      settings += BoardSettingEntity(boardId, key, encodeSettingJson(value), now)
    }
  }

  putOrDelete("description", (get("description") as? String)?.takeIf { it.isNotBlank() })
  putOrDelete("batteryConfig", normalizeBatteryConfig(get("batteryConfig")))
  putOrDelete("dismissedWarnings", normalizeDismissedWarnings(get("dismissedWarnings")))
  putOrDelete("topSpeedKmh", validTopSpeedKmh(get("topSpeedKmh")))
  putOrDelete("alertPreset", normalizeMetricBag(get("alertPreset")))
  putOrDelete("alertPresetsOnboarded", get("alertPresetsOnboarded") as? Boolean)
  putOrDelete("matchBoardConfig", normalizeMetricBag(get("matchBoardConfig")))
  // Legal Mode changes only through the dedicated native intent.
  val link = normalizedBoardLink()
  putOrDelete("transport", BoardTransport.encode(BoardTransport.fromBridge(link?.get("transport"))))
  putOrDelete("linkVersion", (link?.get("linkVersion") as? Number)?.toInt()?.takeIf { it == BOARD_LINK_VERSION })
  putOrDelete("hasBms", link?.get("hasBms") as? Boolean)
  boardLinkStringIdentityKeys.forEach { key ->
    putOrDelete(key, (link?.get(key) as? String)?.takeIf { it.isNotBlank() })
  }

  return settings to deletedKeys
}

private fun BoardSettingEntity.decodeBoardSetting(): Pair<String, Any?>? {
  val raw = try {
    decodeSettingJson(valueJson)
  } catch (_: Exception) {
    return null
  }
  return when (key) {
    "description" -> (raw as? String)?.let { key to it }
    "batteryConfig" -> normalizeBatteryConfig(raw)?.let { key to it }
    "transport" -> (raw as? String)?.let {
      key to BoardTransport.toBridge(BoardTransport.decode(it))
    }
    "linkVersion" -> (raw as? Number)?.toInt()?.let { key to it }
    "hasBms" -> (raw as? Boolean)?.let { key to it }
    "vescFirmwareVersion", "refloatVersion", "refloatBaseVersion" -> (raw as? String)?.let { key to it }
    "lastBattery" -> decodeLastBattery(raw)?.let { key to it }
    "dismissedWarnings" -> normalizeDismissedWarnings(raw)?.let { key to it }
    "topSpeedKmh" -> validTopSpeedKmh(raw)?.let { key to it }
    "alertPreset" -> normalizeMetricBag(raw)?.let { key to it }
    "alertPresetsOnboarded" -> (raw as? Boolean)?.let { key to it }
    "matchBoardConfig" -> normalizeMetricBag(raw)?.let { key to it }
    "legalMode" -> normalizeLegalMode(raw)?.let { key to it }
    else -> null
  }
}

private fun normalizeLegalMode(raw: Any?): Map<String, Boolean>? =
  (raw.asStringKeyMap()?.get("enabled") as? Boolean)?.let { mapOf("enabled" to it) }

/**
 * A durable per-metric Alert Preset bag — the level selection, and which metrics match the board's
 * own configuration. JS owns behavior; native persists each as an opaque object. Non-object/empty
 * payloads normalize away (row removed).
 * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `normalizeMetricBag`
 */
private fun normalizeMetricBag(raw: Any?): Map<String, Any?>? {
  val map = raw.asStringKeyMap() ?: return null
  return map.ifEmpty { null }
}

/**
 * Dismissed Board Warning kinds persisted as a board setting: a non-empty list of kind slugs, or
 * null (row removed) when empty/invalid.
 * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `normalizeDismissedWarnings`
 */
private fun normalizeDismissedWarnings(raw: Any?): List<String>? {
  val list = raw as? List<*> ?: return null
  val kinds = list.filterIsInstance<String>().filter { it.isNotEmpty() }
  return kinds.ifEmpty { null }
}

private fun decodeLastBattery(raw: Any?): Map<String, Any?>? {
  val map = raw as? Map<*, *> ?: return null
  val percent = (map["percent"] as? Number)?.toDouble() ?: return null
  val at = (map["at"] as? Number)?.toLong() ?: return null
  return mapOf(
    "percent" to percent,
    "voltage" to (map["voltage"] as? Number)?.toDouble(),
    "at" to at,
  )
}

internal fun encodeBatteryConfig(value: Any?): String? {
  val config = normalizeBatteryConfig(value) ?: return null
  return config.toJsonObject().toString()
}

internal fun normalizeBatteryConfig(value: Any?): Map<String, Any?>? {
  val config = when (value) {
    is Map<*, *> -> value
    is String -> parseLegacyMapString(value) ?: return null
    else -> return null
  }
  val mode = config["mode"] as? String ?: return null
  return when (mode) {
    "preset" -> {
      val cellPresetId = config["cellPresetId"] as? String ?: return null
      val seriesCount = (config["seriesCount"] as? Number)?.toInt() ?: return null
      val parallelCount = (config["parallelCount"] as? Number)?.toInt() ?: return null
      if (cellPresetId.isBlank() || seriesCount < 1 || parallelCount < 1) return null
      mapOf(
        "mode" to "preset",
        "cellPresetId" to cellPresetId,
        "seriesCount" to seriesCount,
        "parallelCount" to parallelCount,
      )
    }
    "manual" -> {
      val minVoltage = (config["minVoltage"] as? Number)?.toDouble() ?: return null
      val maxVoltage = (config["maxVoltage"] as? Number)?.toDouble() ?: return null
      if (!minVoltage.isFinite() || !maxVoltage.isFinite() || maxVoltage <= minVoltage) return null
      mapOf(
        "mode" to "manual",
        "minVoltage" to minVoltage,
        "maxVoltage" to maxVoltage,
      )
    }
    else -> return null
  }
}

private fun parseLegacyMapString(value: String): Map<String, Any?>? {
  val trimmed = value.trim()
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null
  val body = trimmed.substring(1, trimmed.length - 1)
  if (body.isBlank()) return emptyMap()
  return body.split(", ").mapNotNull { entry ->
    val separator = entry.indexOf('=')
    if (separator <= 0) return@mapNotNull null
    val key = entry.substring(0, separator)
    val raw = entry.substring(separator + 1)
    key to (raw.toIntOrNull() ?: raw.toDoubleOrNull() ?: raw)
  }.toMap()
}

private fun Map<String, Any?>.toAlertRuleEntity(): AlertRuleEntity = AlertRuleEntity(
  boardId = getString("boardId"),
  id = getString("id"),
  controlId = getString("controlId"),
  threshold = getDouble("threshold"),
  thresholdMax = getDoubleOrNull("thresholdMax"),
  thresholdKind = ((get("thresholdRule") as? Map<*, *>)?.get("kind") as? String) ?: "fixed",
  configFieldId = (get("thresholdRule") as? Map<*, *>)?.get("fieldId") as? String,
  thresholdOffset = ((get("thresholdRule") as? Map<*, *>)?.get("thresholdOffset") as? Number)?.toDouble(),
  thresholdMaxOffset = ((get("thresholdRule") as? Map<*, *>)?.get("thresholdMaxOffset") as? Number)?.toDouble(),
  enabled = getBoolean("enabled"),
  soundType = get("soundType") as? String ?: "default",
  createdAt = getLong("createdAt"),
  repeatEverySeconds = normalizedAlertRepeatSeconds(getDoubleOrNull("repeatEverySeconds")),
  beepCount = normalizedAlertBeepCount((get("beepCount") as? Number)?.toInt()),
  source = get("source") as? String,
)

private fun Map<String, Any?>.getString(key: String): String =
  get(key) as? String ?: throw IllegalArgumentException("Missing string field: $key")

private fun Map<String, Any?>.getOptionalString(key: String): String? =
  (get(key) as? String)?.trim()?.takeIf { it.isNotEmpty() }

private fun Map<String, Any?>.getBoolean(key: String): Boolean = when (val value = get(key)) {
  is Boolean -> value
  is Number -> value.toInt() != 0
  else -> false
}

private fun Map<String, Any?>.getLong(key: String): Long =
  (get(key) as? Number)?.toLong() ?: throw IllegalArgumentException("Missing number field: $key")

private fun Map<String, Any?>.getDouble(key: String): Double =
  (get(key) as? Number)?.toDouble() ?: throw IllegalArgumentException("Missing number field: $key")

private fun Map<String, Any?>.getDoubleOrNull(key: String): Double? =
  (get(key) as? Number)?.toDouble()
