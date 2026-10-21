package expo.modules.vescapecore.protocol

import expo.modules.vescapecore.service.SessionConfig

import android.os.SystemClock
import expo.modules.vescapecore.telemetry.TelemetryCapture
import expo.modules.vescapecore.telemetry.TelemetryLocationCapture

/**
 * How stale a GPS fix may be and still be stamped onto a Telemetry Sample.
 *
 * ADR 0034 "Recording never fabricates GPS": [expo.modules.vescapecore.location.LocationTracker]
 * legitimately keeps the last known fix alive for map display and Group Ride presence, but a sample
 * that repeats a dead fix invents a ride that never happened. Beyond this age the sample carries no
 * location and the gap stays honest.
 *
 * This is a *stamping* rule, not a persistence rule. Since ADR 0038 the durable route is Ride
 * Track, written on the GPS clock with no reference to frame arrival; a fix that fails this gate is
 * still recorded there. What the gate governs is the position a sample reports — live and, using
 * the same rule, when the two streams are joined on read.
 *
 * Both sides of the comparison are wall-clock epoch ms — `lastPacketAt` comes from the session
 * clock (`SessionClock.nowMs()`), the fix timestamp from `Location.getTime()`.
 *
 * @parity /modules/vescape-core/ios/telemetry/TelemetryPipeline.swift `telemetryLocationMaxAgeMs`
 */
internal const val TELEMETRY_LOCATION_MAX_AGE_MS = 10_000L

/**
 * Whether this fix may be stamped onto a sample captured at [capturedAtMs]. A fix stamped in the
 * future (clock skew) counts as fresh.
 *
 * @parity /modules/vescape-core/ios/telemetry/TelemetryPipeline.swift `telemetryLocationFreshEnoughToRecord`
 */
internal fun LocationSnapshot.freshEnoughToRecord(capturedAtMs: Long): Boolean =
    capturedAtMs - timestamp <= TELEMETRY_LOCATION_MAX_AGE_MS

internal fun RefloatTelemetry.toCapture(session: SessionConfig, canId: Int?): TelemetryCapture =
    TelemetryCapture(
        capturedAtMs = lastPacketAt,
        elapsedRealtimeMs = SystemClock.elapsedRealtime(),
        boardId = session.appBoardId,
        canId = canId,
        pitch = pitch,
        roll = roll,
        balancePitch = balancePitch,
        balanceCurrent = balanceCurrent,
        speed = speed,
        batteryVoltage = batteryVoltage,
        motorCurrent = motorCurrent,
        batteryCurrent = batteryCurrent,
        erpm = erpm,
        dutyCycle = dutyCycle,
        state = state,
        switchState = switchState,
        adc1 = adc1,
        adc2 = adc2,
        odometer = odometer,
        tempMosfet = tempMosfet,
        tempMotor = tempMotor,
        avgLatency = avgLatency,
        // The sample's own position: a stale or approximate fix is not stamped onto it (ADR 0034),
        // and this decides nothing about durable storage — Ride Track keeps every fix (ADR 0038).
        location = location
            ?.takeIf { it.precise && it.freshEnoughToRecord(lastPacketAt) }
            ?.toCapture(),
    )

internal fun LocationSnapshot.toCapture(): TelemetryLocationCapture =
    TelemetryLocationCapture(
        latitude = latitude,
        longitude = longitude,
        speedMps = speedMps,
        bearingDeg = bearingDeg,
        accuracyM = accuracyM,
        altitudeM = altitudeM,
        timestamp = timestamp,
        precise = precise,
    )
