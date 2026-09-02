package expo.modules.vescapecore.sync

import expo.modules.vescapecore.telemetry.AlertRuleEntity
import expo.modules.vescapecore.telemetry.AppSettingEntity
import expo.modules.vescapecore.telemetry.BoardEntity
import expo.modules.vescapecore.telemetry.BoardSettingEntity
import expo.modules.vescapecore.telemetry.BoardWarningEntity
import expo.modules.vescapecore.telemetry.DiagnosticEventEntity
import expo.modules.vescapecore.telemetry.FavoriteEntity
import expo.modules.vescapecore.telemetry.MetricExclusionRangeEntity
import expo.modules.vescapecore.telemetry.PrivacyZoneEntity
import expo.modules.vescapecore.telemetry.SyncActionEntity
import expo.modules.vescapecore.telemetry.TelemetryFrameEntity
import expo.modules.vescapecore.telemetry.TelemetryMarkerEntity
import expo.modules.vescapecore.telemetry.TelemetryMinuteBucketEntity
import expo.modules.vescapecore.telemetry.TuneHistoryEntryEntity
import expo.modules.vescapecore.telemetry.TuneProfileEntity
import expo.modules.vescapecore.telemetry.VescFaultCaptureEntity
import expo.modules.vescapecore.telemetry.VescFaultCaptureSampleEntity
import expo.modules.vescapecore.telemetry.VescFaultOccurrenceEntity

/**
 * Local rows as the server reads them.
 *
 * Every encoder is strongly typed and validates before transport, so a batch is refused here — with
 * the row retained and one metadata-only Diagnostic Event — rather than wedging against the server.
 * The field sets mirror `vescape-server` `src/sync/protocol.ts`; a column the server does not declare
 * is not sent, because an unknown field rejects the whole batch.
 *
 * @parity /modules/vescape-core/ios/sync/SyncWire.swift
 * @parity /modules/vescape-server/src/sync/protocol.ts
 */
object SyncWire {
  fun appSetting(row: AppSettingEntity): String = SyncRowWriter(SyncTable.APP_SETTINGS)
    .keyText("key", row.key)
    .text("valueJson", row.valueJson)
    .timestamp("updatedAt", row.updatedAt)
    .build()

  /**
   * `transport` is iOS-only; Android keeps it in board settings and sends null, exactly as the
   * server's own comment describes.
   */
  fun board(row: BoardEntity): String = SyncRowWriter(SyncTable.BOARDS)
    .keyText("id", row.id)
    .text("name", row.name)
    .text("bleId", row.bleId)
    .text("transport", null)
    .timestamp("createdAt", row.createdAt)
    .timestamp("updatedAt", row.updatedAt)
    .build()

  fun boardSetting(row: BoardSettingEntity): String = SyncRowWriter(SyncTable.BOARD_SETTINGS)
    .keyText("boardId", row.boardId)
    .keyText("key", row.key)
    .text("valueJson", row.valueJson)
    .timestamp("updatedAt", row.updatedAt)
    .build()

  fun boardWarning(row: BoardWarningEntity): String = SyncRowWriter(SyncTable.BOARD_WARNINGS)
    .keyText("boardId", row.boardId)
    .keyText("kind", row.kind)
    .text("severity", row.severity)
    .timestamp("firstDetectedAt", row.firstDetectedAt)
    .timestamp("lastDetectedAt", row.lastDetectedAt)
    .text("payloadJson", row.payloadJson)
    .timestamp("updatedAt", row.updatedAt)
    .build()

  /**
   * The threshold numbers travel with the kind that says how to read them: a config-relative rule
   * restored as a bare number looks configured and fires at the wrong point, which is worse than
   * losing it.
   */
  fun alert(row: AlertRuleEntity): String = SyncRowWriter(SyncTable.ALERTS)
    .keyText("boardId", row.boardId)
    .keyText("id", row.id)
    .keyText("controlId", row.controlId)
    .number("threshold", row.threshold)
    .number("thresholdMax", row.thresholdMax)
    .keyText("thresholdKind", row.thresholdKind)
    .nullableKeyText("configFieldId", row.configFieldId)
    .number("thresholdOffset", row.thresholdOffset)
    .number("thresholdMaxOffset", row.thresholdMaxOffset)
    .bool("enabled", row.enabled)
    .text("soundType", row.soundType)
    .timestamp("repeatEverySeconds", row.repeatEverySeconds)
    .count("beepCount", row.beepCount)
    .text("source", row.source)
    .timestamp("createdAt", row.createdAt)
    .timestamp("updatedAt", row.updatedAt)
    .build()

  fun tuneProfile(row: TuneProfileEntity): String = SyncRowWriter(SyncTable.TUNE_PROFILES)
    .keyText("id", row.id)
    .keyText("boardId", row.boardId)
    // May legitimately be empty: the app defaults an unknown Refloat package version to `''`.
    .derivedKeyText("refloatBaseVersion", row.refloatBaseVersion)
    .text("name", row.name)
    .text("icon", row.icon)
    .text("color", row.color)
    .text("fieldsJson", row.fieldsJson)
    .timestamp("createdAt", row.createdAt)
    .timestamp("updatedAt", row.updatedAt)
    .build()

  /** Carries no id: the local one restarts on a fresh install, so identity is `(profileId, createdAt)`. */
  fun tuneHistoryEntry(row: TuneHistoryEntryEntity): String =
    SyncRowWriter(SyncTable.TUNE_HISTORY_ENTRIES)
      .keyText("profileId", row.profileId)
      .text("fieldsJson", row.fieldsJson)
      .timestamp("createdAt", row.createdAt)
      .build()

  fun privacyZone(row: PrivacyZoneEntity): String = SyncRowWriter(SyncTable.PRIVACY_ZONES)
    .keyText("id", row.id)
    .text("preset", row.preset)
    .text("name", row.name)
    .bool("enabled", row.enabled)
    .int32("centerLatitudeE7", row.centerLatitudeE7)
    .int32("centerLongitudeE7", row.centerLongitudeE7)
    .int32("radiusMeters", row.radiusMeters)
    .timestamp("createdAt", row.createdAt)
    .timestamp("updatedAt", row.updatedAt)
    .build()

  fun telemetryMarker(row: TelemetryMarkerEntity): String = SyncRowWriter(SyncTable.TELEMETRY_MARKERS)
    .timestamp("occurredAtMs", row.occurredAtMs)
    .timestamp("elapsedRealtimeMs", row.elapsedRealtimeMs)
    .keyText("type", row.type)
    .derivedKeyText("boardId", row.boardId)
    .text("message", row.message)
    .timestamp("gapMs", row.gapMs)
    .build()

  fun metricExclusionRange(row: MetricExclusionRangeEntity): String =
    SyncRowWriter(SyncTable.METRIC_EXCLUSION_RANGES)
      .derivedKeyText("boardId", row.boardId)
      .text("reason", row.reason)
      .timestamp("startMs", row.startMs)
      .timestamp("endMs", row.endMs)
      .count("sampleCount", row.sampleCount)
      .build()

  fun diagnosticEvent(row: DiagnosticEventEntity): String = SyncRowWriter(SyncTable.DIAGNOSTIC_EVENTS)
    .timestamp("occurredAtMs", row.occurredAtMs)
    .timestamp("elapsedRealtimeMs", row.elapsedRealtimeMs)
    .keyText("eventName", row.eventName)
    .derivedKeyText("operation", row.operation)
    .derivedKeyText("phase", row.phase)
    .derivedKeyText("boardId", row.boardId)
    .text("message", row.message)
    .text("propertiesJson", row.propertiesJson)
    .build()

  /**
   * A Telemetry Sample as recorded: still delta-encoded, carrying the Changed Masks. The local row
   * id and the per-row device columns never cross the wire — the Board reference replaces them
   * (ADR-0028) and a restored phone's full re-upload has to be an idempotent no-op.
   *
   * A frame that names no Board cannot be encoded; [SyncSource] never offers one.
   */
  fun telemetryFrame(row: TelemetryFrameEntity): String = SyncRowWriter(SyncTable.TELEMETRY_FRAMES)
    .keyText(
      "boardId",
      row.boardId
        ?: throw SyncProtocolException(SyncTable.TELEMETRY_FRAMES, "boardId", "must name a Board"),
    )
    .timestamp("capturedAtMs", row.capturedAtMs)
    .timestamp("elapsedRealtimeMs", row.elapsedRealtimeMs)
    .int32("canId", row.canId)
    .count("flags", row.flags)
    .count("changedMask1", row.changedMask1)
    .count("changedMask2", row.changedMask2)
    .int32("speedCentiKmh", row.speedCentiKmh)
    .int32("batteryVoltageMv", row.batteryVoltageMv)
    .int32("motorCurrentMa", row.motorCurrentMa)
    .int32("batteryCurrentMa", row.batteryCurrentMa)
    .int32("dutyPermille", row.dutyPermille)
    .int32("pitchCentiDeg", row.pitchCentiDeg)
    .int32("rollCentiDeg", row.rollCentiDeg)
    .int32("balancePitchCentiDeg", row.balancePitchCentiDeg)
    .int32("balanceCurrentMa", row.balanceCurrentMa)
    .int32("erpm", row.erpm)
    .int32("state", row.state)
    .int32("switchState", row.switchState)
    .int32("adc1Milli", row.adc1Milli)
    .int32("adc2Milli", row.adc2Milli)
    .int64("odometerCm", row.odometerCm)
    .int32("tempMosfetDeciC", row.tempMosfetDeciC)
    .int32("tempMotorDeciC", row.tempMotorDeciC)
    .int32("latitudeE7", row.latitudeE7)
    .int32("longitudeE7", row.longitudeE7)
    .int32("gpsSpeedCentiMps", row.gpsSpeedCentiMps)
    .int32("bearingCentiDeg", row.bearingCentiDeg)
    .int32("accuracyCm", row.accuracyCm)
    .int32("altitudeCm", row.altitudeCm)
    .timestamp("locationTimestampMs", row.locationTimestampMs)
    .build()

  fun telemetryMinuteBucket(row: TelemetryMinuteBucketEntity): String =
    SyncRowWriter(SyncTable.TELEMETRY_MINUTE_BUCKETS)
      .keyText("boardId", row.boardId)
      .timestamp("bucketStartMs", row.bucketStartMs)
      .timestamp("updatedAt", row.updatedAt)
      .count("sampleCount", row.sampleCount)
      .timestamp("firstSampleAtMs", row.firstSampleAtMs)
      .timestamp("lastSampleAtMs", row.lastSampleAtMs)
      .int64("sumAbsSpeedCentiKmh", row.sumAbsSpeedCentiKmh)
      .count("movingSpeedSampleCount", row.movingSpeedSampleCount)
      .int64("sumMovingAbsSpeedCentiKmh", row.sumMovingAbsSpeedCentiKmh)
      .int32("maxAbsSpeedCentiKmh", row.maxAbsSpeedCentiKmh)
      .int32("minBatteryVoltageMv", row.minBatteryVoltageMv)
      .int32("maxMotorCurrentAbsMa", row.maxMotorCurrentAbsMa)
      .int32("maxBatteryCurrentAbsMa", row.maxBatteryCurrentAbsMa)
      .int64("batteryUsedWhMilli", row.batteryUsedWhMilli)
      .int64("batteryRegenWhMilli", row.batteryRegenWhMilli)
      .int32("maxDutyAbsPermille", row.maxDutyAbsPermille)
      .int64("firstOdometerCm", row.firstOdometerCm)
      .int64("lastOdometerCm", row.lastOdometerCm)
      .count("gpsPointCount", row.gpsPointCount)
      .count("preciseGpsPointCount", row.preciseGpsPointCount)
      .int64("gpsDistanceCm", row.gpsDistanceCm)
      .int32("maxGpsSpeedCentiMps", row.maxGpsSpeedCentiMps)
      .int32("maxTempMosfetDeciC", row.maxTempMosfetDeciC)
      .int32("maxTempMotorDeciC", row.maxTempMotorDeciC)
      .int32("firstLatitudeE7", row.firstLatitudeE7)
      .int32("firstLongitudeE7", row.firstLongitudeE7)
      .timestamp("firstMovingAtMs", row.firstMovingAtMs)
      .timestamp("lastMovingAtMs", row.lastMovingAtMs)
      .build()

  /** The Board name is resolved on read rather than snapshotted, so none crosses the wire. */
  fun favorite(row: FavoriteEntity): String = SyncRowWriter(SyncTable.FAVORITES)
    .keyText("id", row.id)
    .nullableKeyText("boardId", row.boardId)
    .text("name", row.name)
    .timestamp("startMs", row.startMs)
    .timestamp("endMs", row.endMs)
    .timestamp("createdAt", row.createdAt)
    .timestamp("updatedAt", row.updatedAt)
    .count("sampleCount", row.sampleCount)
    .count("gpsPointCount", row.gpsPointCount)
    .int64("distanceCm", row.distanceCm)
    .timestamp("movingDurationMs", row.movingDurationMs)
    .int32("avgSpeedCentiKmh", row.avgSpeedCentiKmh)
    .int32("maxSpeedCentiKmh", row.maxSpeedCentiKmh)
    .int64("batteryUsedWhMilli", row.batteryUsedWhMilli)
    .build()

  /**
   * One VESC Fault Occurrence: firmware-authored live evidence, keyed on the app's own minted id
   * because the same code activating twice is two occurrences, never one row keyed on the code.
   *
   * `updatedAt` is carried in its own right rather than derived from `lastObservedAtMs`: a Rider
   * dismissing an occurrence changes the row without the fault being observed again.
   */
  fun vescFaultOccurrence(row: VescFaultOccurrenceEntity): String =
    SyncRowWriter(SyncTable.VESC_FAULT_OCCURRENCES)
      .keyText("id", row.id)
      .keyText("boardId", row.boardId)
      .int32("code", row.code)
      .timestamp("occurredAtMs", row.occurredAtMs)
      .timestamp("lastObservedAtMs", row.lastObservedAtMs)
      .timestamp("clearedAtMs", row.clearedAtMs)
      .bool("dismissed", row.dismissed)
      .timestamp("updatedAt", row.updatedAt)
      .build()

  /**
   * One VESC Fault Capture. Keyed by the Occurrence — one Occurrence has at most one Capture — so
   * the parent reference and the identity are the same field. Immutable, so it carries no change
   * timestamp and a re-send is a no-op rather than an upsert.
   */
  fun vescFaultCapture(row: VescFaultCaptureEntity): String =
    SyncRowWriter(SyncTable.VESC_FAULT_CAPTURES)
      .keyText("occurrenceId", row.occurrenceId)
      .keyText("boardId", row.boardId)
      .timestamp("startedAtMs", row.startedAtMs)
      .timestamp("openedAtMs", row.openedAtMs)
      .count("sampleCount", row.sampleCount)
      .build()

  /**
   * One decoded sample inside a Capture, identified by its Occurrence and its capture time. The
   * local autoincrement id never crosses the wire — it restarts on a fresh install, exactly as a
   * Tune History entry's does.
   *
   * Every value is nullable: a sample carries what that Board Session actually reported, and a
   * field the firmware did not send is absent rather than zero.
   */
  fun vescFaultCaptureSample(row: VescFaultCaptureSampleEntity): String =
    SyncRowWriter(SyncTable.VESC_FAULT_CAPTURE_SAMPLES)
      .keyText("occurrenceId", row.occurrenceId)
      .timestamp("capturedAtMs", row.capturedAtMs)
      .reading("speed", row.speed)
      .reading("dutyCycle", row.dutyCycle)
      .reading("erpm", row.erpm)
      .reading("batteryVoltage", row.batteryVoltage)
      .reading("batteryCurrent", row.batteryCurrent)
      .reading("motorCurrent", row.motorCurrent)
      .reading("tempMosfet", row.tempMosfet)
      .reading("tempMotor", row.tempMotor)
      .reading("pitch", row.pitch)
      .reading("roll", row.roll)
      .reading("balancePitch", row.balancePitch)
      .reading("adc1", row.adc1)
      .reading("adc2", row.adc2)
      .int32("state", row.state)
      .build()

  /**
   * One Sync Action, flat: the target, the identity within that target's scope, and when the Rider
   * removed it. The log's own `board_id`/`key` pair expands into the identity fields the server
   * declares for that target, so an action reads like the row it names.
   */
  fun deleteAction(row: SyncActionEntity): String {
    val writer = SyncRowWriter(SyncTable.DELETE_ACTIONS).keyText("target", row.target)
    when (row.target) {
      "appSetting" -> writer.keyText("key", row.key)
      "board" -> writer.keyText("id", row.id())
      "boardSetting" -> writer.keyText("boardId", row.board()).keyText("key", row.key)
      "boardWarning" -> writer.keyText("boardId", row.board()).keyText("kind", row.key)
      "alert" -> writer.keyText("boardId", row.board()).keyText("id", row.key)
      "tuneProfile", "privacyZone", "favorite" -> writer.keyText("id", row.key)
      else -> throw SyncProtocolException(SyncTable.DELETE_ACTIONS, "target", "is not a known target")
    }
    return writer.timestamp("deletedAt", row.deletedAt).build()
  }

  private fun SyncActionEntity.id(): String = key

  private fun SyncActionEntity.board(): String = boardId
    ?: throw SyncProtocolException(SyncTable.DELETE_ACTIONS, "boardId", "is missing for $target")
}
