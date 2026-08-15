package expo.modules.vescapecore.protocol

data class RefloatTelemetry(
    val hasFault: Boolean,
    val faultCode: Int,
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
    val pullRateHz: Double?,
    val lastPacketAt: Long,
    val location: LocationSnapshot?,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "hasFault" to hasFault,
        "faultCode" to faultCode,
        "pitch" to pitch,
        "roll" to roll,
        "balancePitch" to balancePitch,
        "balanceCurrent" to balanceCurrent,
        "speed" to speed,
        "batteryVoltage" to batteryVoltage,
        "motorCurrent" to motorCurrent,
        "batteryCurrent" to batteryCurrent,
        "erpm" to erpm,
        "dutyCycle" to dutyCycle,
        "state" to state,
        "stateName" to stateName(state),
        "switchState" to switchState,
        "adc1" to adc1,
        "adc2" to adc2,
        "odometer" to odometer,
        "tempMosfet" to tempMosfet,
        "tempMotor" to tempMotor,
        "avgLatency" to avgLatency,
        "pullRateHz" to pullRateHz,
        "lastPacketAt" to lastPacketAt,
        "location" to location?.toMap(),
    )
}

data class BmsTelemetry(
    val capturedAt: Long,
    val voltageTotal: Double,
    val vCharge: Double,
    val current: Double,
    val currentIc: Double,
    val ampHours: Double,
    val wattHours: Double,
    val soc: Double?,
    val soh: Double?,
    val cellVoltages: List<Double>,
    val balancing: List<Boolean>,
    val temps: List<Double>,
    val tempIc: Double?,
    val tempHum: Double?,
    val humidity: Double?,
    val tempMaxCell: Double?,
    val canId: Int?,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "capturedAt" to capturedAt,
        "voltageTotal" to voltageTotal,
        "vCharge" to vCharge,
        "current" to current,
        "currentIc" to currentIc,
        "ampHours" to ampHours,
        "wattHours" to wattHours,
        "soc" to soc,
        "soh" to soh,
        "cellVoltages" to cellVoltages,
        "balancing" to balancing,
        "temps" to temps,
        "tempIc" to tempIc,
        "tempHum" to tempHum,
        "hum" to humidity,
        "tempMaxCell" to tempMaxCell,
        "canId" to canId,
    )
}

/**
 * One GPS fix as everything downstream sees it.
 *
 * @parity /modules/vescape-core/ios/telemetry/TelemetryPipeline.swift `TelemetryLocationCapture`
 * @parity /modules/vescape-core/src/index.ts `LocationEvent`
 */
data class LocationSnapshot(
    val latitude: Double,
    val longitude: Double,
    val speedMps: Double?,
    val bearingDeg: Double?,
    val accuracyM: Double?,
    val altitudeM: Double?,
    val timestamp: Long,
    val precise: Boolean,
    /**
     * The reliable course from [expo.modules.vescapecore.location.GpsCourseDeriver], not the raw
     * [bearingDeg]. Null on approximate fixes and wherever a snapshot is rebuilt from storage.
     */
    val courseDeg: Double? = null,
    /** The fix [courseDeg] was derived from; older than [timestamp] while a course is retained. */
    val courseSourceTimestamp: Long? = null,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "latitude" to latitude,
        "longitude" to longitude,
        "speedMps" to speedMps,
        "bearingDeg" to bearingDeg,
        "accuracyM" to accuracyM,
        "altitudeM" to altitudeM,
        "timestamp" to timestamp,
        "precise" to precise,
        "courseDeg" to courseDeg,
        "courseSourceTimestamp" to courseSourceTimestamp,
    )
}

private fun stateName(state: Int): String {
    return when (state and 0x0f) {
        0 -> "STARTUP"
        1 -> "RUNNING"
        2 -> "TILTBACK"
        3 -> "WHEELSLIP"
        4 -> "UPSIDEDOWN"
        5 -> "FLYWHEEL"
        6 -> "FAULT_PITCH"
        7 -> "FAULT_ROLL"
        8 -> "FAULT_SW_HALF"
        9 -> "FAULT_SW_FULL"
        11 -> "FAULT_STARTUP"
        12 -> "FAULT_REVERSE"
        13 -> "FAULT_QUICKSTOP"
        14 -> "CHARGING"
        15 -> "DISABLED"
        else -> "UNKNOWN"
    }
}
