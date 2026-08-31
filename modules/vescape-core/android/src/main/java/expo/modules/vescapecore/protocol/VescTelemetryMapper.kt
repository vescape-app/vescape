package expo.modules.vescapecore.protocol

import expo.modules.vescapecore.service.SessionConfig

import android.os.SystemClock
import expo.modules.vescapecore.telemetry.TelemetryCapture
import expo.modules.vescapecore.telemetry.TelemetryLocationCapture

/**
 * How stale a GPS fix may be and still be stamped onto a recorded telemetry frame.
 *
 * ADR 0034 "Recording never fabricates GPS": [expo.modules.vescapecore.location.LocationTracker]
 * legitimately keeps the last known fix alive for map display and Group Ride presence, but a
 * recorded frame that repeats a dead fix invents a ride that never happened. Beyond this age the
 * frame records no location and the route gap stays honest.
 *
 * Both sides of the comparison are wall-clock epoch ms — `lastPacketAt` comes from the session
 * clock (`SessionClock.nowMs()`), the fix timestamp from `Location.getTime()`.
 *
 * @parity /modules/vescape-core/ios/telemetry/TelemetryPipeline.swift `telemetryLocationMaxAgeMs`
 */
internal const val TELEMETRY_LOCATION_MAX_AGE_MS = 10_000L

/**
 * Whether this fix may be recorded on a frame captured at [capturedAtMs]. A fix stamped in the
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
        // Recorded frames refuse a stale fix (ADR 0034); live display keeps the last known one.
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
