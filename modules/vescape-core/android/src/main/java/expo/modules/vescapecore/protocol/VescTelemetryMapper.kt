package expo.modules.vescapecore.protocol

import expo.modules.vescapecore.service.SessionConfig

import android.os.SystemClock
import expo.modules.vescapecore.telemetry.TelemetryCapture
import expo.modules.vescapecore.telemetry.TelemetryLocationCapture

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryPipeline.swift `telemetryLocationMaxAgeMs`
 */
internal const val TELEMETRY_LOCATION_MAX_AGE_MS = 10_000L

/**
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
