package expo.modules.vescapecore.ow

import expo.modules.vescapecore.protocol.RefloatTelemetry

/**
 * Latest-values snapshot of the OneWheel channels that feed app telemetry. Null = characteristic
 * never delivered (e.g. battery voltage is gone on firmware >= 4155).
 */
internal data class OwFrame(
  val atMs: Long,
  val rpm: Int? = null,
  val speedKmh: Double? = null,
  val batteryPercent: Int? = null,
  val batteryVoltage: Double? = null,
  val batteryCurrent: Double? = null,
  val pitchDeg: Double? = null,
  val rollDeg: Double? = null,
  val controllerTempC: Double? = null,
  val motorTempC: Double? = null,
  val rideMode: Int? = null,
  val lifetimeOdometerM: Double? = null,
  val faultCode: Int? = null,
)

private const val MILES_TO_METERS = 1609.344

internal fun owLifetimeMilesToMeters(miles: Int): Double = miles * MILES_TO_METERS

/**
 * OneWheel sends each metric as an independent characteristic notification. Every mapped live
 * channel refreshes the latest-values cache and requests a frame; [OwGattClient] coalesces those
 * requests to avoid multiplying one board update into a burst of partial JS events.
 */
internal fun shouldScheduleOwTelemetryFrame(phase: OwPhase, shortId: Int?): Boolean =
  phase == OwPhase.Ready && shortId in setOf(
    OW_CHAR_RIDE_MODE,
    OW_CHAR_BATTERY,
    OW_CHAR_RPM,
    0xf316, // battery voltage
    0xf312, // battery current
    0xf307, // pitch
    0xf308, // roll
    0xf310, // controller + motor temperatures
    0xf319, // lifetime odometer
    0xf31c, // fault code
  )

/**
 * OneWheel is a one-wheel board: its channels map onto the shared telemetry shape, so the whole
 * app (gauges, charts, recording, alerts) consumes it without learning the source. Channels FM
 * does not expose stay at neutral defaults (duty, motor-side current, footpad ADCs).
 */
internal fun OwFrame.toRefloatTelemetry(): RefloatTelemetry = RefloatTelemetry(
  hasFault = (faultCode ?: 0) != 0,
  faultCode = faultCode ?: 0,
  pitch = pitchDeg ?: 0.0,
  roll = rollDeg ?: 0.0,
  balancePitch = pitchDeg ?: 0.0,
  balanceCurrent = 0.0,
  speed = speedKmh ?: 0.0,
  batteryVoltage = batteryVoltage ?: 0.0,
  motorCurrent = 0.0,
  batteryCurrent = batteryCurrent ?: 0.0,
  erpm = rpm ?: 0,
  dutyCycle = 0.0,
  state = rideMode ?: 0,
  switchState = 0,
  adc1 = 0.0,
  adc2 = 0.0,
  odometer = lifetimeOdometerM,
  tempMosfet = controllerTempC,
  tempMotor = motorTempC,
  avgLatency = null,
  pullRateHz = null,
  lastPacketAt = atMs,
  location = null,
)
