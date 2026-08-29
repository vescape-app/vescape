package expo.modules.vescapecore.telemetry

import kotlin.math.abs
import kotlin.math.roundToLong

// @parity /modules/vescape-core/ios/telemetry/TelemetryBucketBuilder.swift
internal const val TELEMETRY_BUCKET_SIZE_MS = 60_000L
internal const val UNKNOWN_TELEMETRY_DEVICE_ID = ""
internal const val UNKNOWN_TELEMETRY_DEVICE_NAME = "VESC Board"
private const val MAX_ENERGY_SAMPLE_GAP_MS = 5_000L

internal data class BucketTelemetryPoint(
  val capturedAtMs: Long,
  val deviceId: String?,
  val deviceName: String?,
  val speedCentiKmh: Int,
  val batteryVoltageMv: Int,
  val motorCurrentMa: Int,
  val batteryCurrentMa: Int,
  val dutyPermille: Int,
  val odometerCm: Long?,
  val tempMosfetDeciC: Int? = null,
  val tempMotorDeciC: Int? = null,
  val gpsSpeedCentiMps: Int? = null,
  val gpsTimestampMs: Long? = null,
  val gpsAccuracyCm: Int? = null,
  val excludedFromAvgSpeed: Boolean = false,
  val excludedFromMaxSpeed: Boolean = false,
  val excludedFromMaxDuty: Boolean = false,
)

internal data class BucketLocationPoint(
  val capturedAtMs: Long,
  val deviceId: String?,
  val deviceName: String?,
  val precise: Boolean,
  val distanceFromPreviousCm: Long?,
  val gpsSpeedCentiMps: Int?,
  val latitudeE7: Int? = null,
  val longitudeE7: Int? = null,
)

// @parity /modules/vescape-core/ios/telemetry/TelemetryBucketBuilder.swift `buildTelemetryBuckets`
internal fun buildTelemetryBuckets(
  telemetryPoints: List<BucketTelemetryPoint>,
  locationPoints: List<BucketLocationPoint>,
): Collection<TelemetryMinuteBucketEntity> {
  val buckets = linkedMapOf<Pair<Long, String>, MutableBucket>()
  for (point in telemetryPoints) {
    val bucketStart = point.capturedAtMs - (point.capturedAtMs % TELEMETRY_BUCKET_SIZE_MS)
    val deviceId = point.deviceId ?: UNKNOWN_TELEMETRY_DEVICE_ID
    val key = bucketStart to deviceId
    val bucket = buckets.getOrPut(key) {
      MutableBucket(bucketStart, deviceId, point.deviceName)
    }
    bucket.add(point)
  }
  for (point in locationPoints) {
    val bucketStart = point.capturedAtMs - (point.capturedAtMs % TELEMETRY_BUCKET_SIZE_MS)
    val deviceId = point.deviceId ?: UNKNOWN_TELEMETRY_DEVICE_ID
    val key = bucketStart to deviceId
    val bucket = buckets[key] ?: continue
    bucket.addLocation(point)
  }
  return buckets.values.map { it.toEntity() }
}

private class MutableBucket(
  private val bucketStartMs: Long,
  private val deviceId: String,
  private var deviceName: String?,
) {
  private var sampleCount = 0
  private var firstSampleAtMs = Long.MAX_VALUE
  private var lastSampleAtMs = Long.MIN_VALUE
  private var sumAbsSpeedCentiKmh = 0L
  private var movingSpeedSampleCount = 0
  private var sumMovingAbsSpeedCentiKmh = 0L
  private var firstMovingAtMs: Long? = null
  private var lastMovingAtMs: Long? = null
  private var maxAbsSpeedCentiKmh = 0
  private var minBatteryVoltageMv: Int? = null
  private var maxMotorCurrentAbsMa = 0
  private var maxBatteryCurrentAbsMa = 0
  private var batteryUsedWhMilli = 0L
  private var batteryRegenWhMilli = 0L
  private var maxDutyAbsPermille = 0
  private var firstOdometerCm: Long? = null
  private var lastOdometerCm: Long? = null
  private var gpsPointCount = 0
  private var preciseGpsPointCount = 0
  private var gpsDistanceCm = 0L
  private var maxGpsSpeedCentiMps: Int? = null
  private var maxTempMosfetDeciC: Int? = null
  private var maxTempMotorDeciC: Int? = null
  private var firstLatitudeE7: Int? = null
  private var firstLongitudeE7: Int? = null
  private var lastEnergyPoint: BucketTelemetryPoint? = null

  fun add(point: BucketTelemetryPoint) {
    sampleCount++
    if (point.deviceName != null) deviceName = point.deviceName
    firstSampleAtMs = minOf(firstSampleAtMs, point.capturedAtMs)
    lastSampleAtMs = maxOf(lastSampleAtMs, point.capturedAtMs)
    val absSpeed = abs(point.speedCentiKmh)
    sumAbsSpeedCentiKmh += absSpeed.toLong()
    if (!point.excludedFromAvgSpeed) {
      movingSpeedSampleCount++
      sumMovingAbsSpeedCentiKmh += absSpeed.toLong()
      firstMovingAtMs = minOf(firstMovingAtMs ?: point.capturedAtMs, point.capturedAtMs)
      lastMovingAtMs = maxOf(lastMovingAtMs ?: point.capturedAtMs, point.capturedAtMs)
    }
    if (!point.excludedFromMaxSpeed) {
      maxAbsSpeedCentiKmh = maxOf(maxAbsSpeedCentiKmh, absSpeed)
    }
    minBatteryVoltageMv = minBatteryVoltageMv?.let { minOf(it, point.batteryVoltageMv) }
      ?: point.batteryVoltageMv
    maxMotorCurrentAbsMa = maxOf(maxMotorCurrentAbsMa, abs(point.motorCurrentMa))
    maxBatteryCurrentAbsMa = maxOf(maxBatteryCurrentAbsMa, abs(point.batteryCurrentMa))
    if (!point.excludedFromMaxDuty) {
      maxDutyAbsPermille = maxOf(maxDutyAbsPermille, abs(point.dutyPermille))
    }
    if (firstOdometerCm == null) firstOdometerCm = point.odometerCm
    if (point.odometerCm != null) lastOdometerCm = point.odometerCm
    point.tempMosfetDeciC?.let { t -> maxTempMosfetDeciC = maxOf(maxTempMosfetDeciC ?: t, t) }
    point.tempMotorDeciC?.let { t -> maxTempMotorDeciC = maxOf(maxTempMotorDeciC ?: t, t) }

    lastEnergyPoint?.let { previous ->
      val dtMs = point.capturedAtMs - previous.capturedAtMs
      if (dtMs > 0L && dtMs <= MAX_ENERGY_SAMPLE_GAP_MS) {
        val voltageV = previous.batteryVoltageMv / 1000.0
        val currentA = previous.batteryCurrentMa / 1000.0
        val wh = voltageV * currentA * dtMs / 3_600_000.0
        val whMilli = (abs(wh) * 1000.0).roundToLong()
        when {
          wh > 0.0 -> batteryUsedWhMilli += whMilli
          wh < 0.0 -> batteryRegenWhMilli += whMilli
        }
      }
    }
    lastEnergyPoint = point
  }

  fun addLocation(point: BucketLocationPoint) {
    gpsPointCount++
    if (point.precise) preciseGpsPointCount++
    if (point.deviceName != null) deviceName = point.deviceName
    firstSampleAtMs = minOf(firstSampleAtMs, point.capturedAtMs)
    lastSampleAtMs = maxOf(lastSampleAtMs, point.capturedAtMs)
    if (firstLatitudeE7 == null && point.latitudeE7 != null) {
      firstLatitudeE7 = point.latitudeE7
      firstLongitudeE7 = point.longitudeE7
    }
    gpsDistanceCm += point.distanceFromPreviousCm ?: 0L
    maxGpsSpeedCentiMps = when {
      maxGpsSpeedCentiMps == null -> point.gpsSpeedCentiMps
      point.gpsSpeedCentiMps == null -> maxGpsSpeedCentiMps
      else -> maxOf(maxGpsSpeedCentiMps ?: 0, point.gpsSpeedCentiMps)
    }
  }

  fun toEntity(): TelemetryMinuteBucketEntity = TelemetryMinuteBucketEntity(
    bucketStartMs = bucketStartMs,
    deviceId = deviceId,
    deviceName = deviceName,
    sampleCount = sampleCount,
    firstSampleAtMs = firstSampleAtMs,
    lastSampleAtMs = lastSampleAtMs,
    sumAbsSpeedCentiKmh = sumAbsSpeedCentiKmh,
    movingSpeedSampleCount = movingSpeedSampleCount,
    sumMovingAbsSpeedCentiKmh = sumMovingAbsSpeedCentiKmh,
    maxAbsSpeedCentiKmh = maxAbsSpeedCentiKmh,
    minBatteryVoltageMv = minBatteryVoltageMv,
    maxMotorCurrentAbsMa = maxMotorCurrentAbsMa,
    maxBatteryCurrentAbsMa = maxBatteryCurrentAbsMa,
    batteryUsedWhMilli = batteryUsedWhMilli,
    batteryRegenWhMilli = batteryRegenWhMilli,
    maxDutyAbsPermille = maxDutyAbsPermille,
    firstOdometerCm = firstOdometerCm,
    lastOdometerCm = lastOdometerCm,
    gpsPointCount = gpsPointCount,
    preciseGpsPointCount = preciseGpsPointCount,
    gpsDistanceCm = gpsDistanceCm,
    maxGpsSpeedCentiMps = maxGpsSpeedCentiMps,
    maxTempMosfetDeciC = maxTempMosfetDeciC,
    maxTempMotorDeciC = maxTempMotorDeciC,
    firstLatitudeE7 = firstLatitudeE7,
    firstLongitudeE7 = firstLongitudeE7,
    firstMovingAtMs = firstMovingAtMs,
    lastMovingAtMs = lastMovingAtMs,
  )
}
