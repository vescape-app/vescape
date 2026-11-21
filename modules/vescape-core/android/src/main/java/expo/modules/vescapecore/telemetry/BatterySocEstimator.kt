package expo.modules.vescapecore.telemetry

import android.content.Context
import org.json.JSONArray

// @parity /modules/vescape-core/ios/telemetry/BatterySocEstimator.swift
object BatterySocEstimator {

    data class SocPoint(val voltage: Double, val soc: Double)

    data class NormPoint(val norm: Double, val soc: Double)

    private val MANUAL_CURVE: List<NormPoint> = listOf(
        NormPoint(1.0, 100.0),
        NormPoint(0.95, 90.0),
        NormPoint(0.9, 75.0),
        NormPoint(0.82, 55.0),
        NormPoint(0.72, 35.0),
        NormPoint(0.55, 18.0),
        NormPoint(0.35, 7.0),
        NormPoint(0.15, 2.0),
        NormPoint(0.0, 0.0),
    )

    data class CellPreset(
        val id: String,
        val socCurve: List<SocPoint>,
        val internalResistanceMilliOhm: Int,
    )

    private const val DEFAULT_INTERNAL_RESISTANCE_MILLIOHM = 18

    private var presetById: Map<String, CellPreset> = emptyMap()

    fun init(context: Context) {
        val json = context.assets.open("data/cell-presets.json").bufferedReader().readText()
        loadPresets(json)
    }

    fun ensureInitialized(context: Context) {
        if (presetById.isEmpty()) init(context)
    }

    fun loadPresets(json: String) {
        val root = org.json.JSONObject(json)
        val curvesObj = root.getJSONObject("curves")
        val curves = mutableMapOf<String, List<SocPoint>>()
        for (key in curvesObj.keys()) {
            val arr = curvesObj.getJSONArray(key)
            val points = mutableListOf<SocPoint>()
            for (i in 0 until arr.length()) {
                val pt = arr.getJSONObject(i)
                points.add(SocPoint(pt.getDouble("voltage"), pt.getDouble("soc")))
            }
            curves[key] = points
        }
        val cellsArr = root.getJSONArray("cells")
        val map = mutableMapOf<String, CellPreset>()
        for (i in 0 until cellsArr.length()) {
            val obj = cellsArr.getJSONObject(i)
            val id = obj.getString("id")
            val ir = obj.getInt("internalResistanceMilliOhm")
            val curveId = obj.getString("curveId")
            val curve = curves[curveId] ?: continue
            map[id] = CellPreset(id, curve, ir)
        }
        presetById = map
    }

    fun getCellPreset(id: String): CellPreset? = presetById[id]

    private fun interpolateCurve(voltage: Double, curve: List<SocPoint>): Double {
        val first = curve.first()
        val last = curve.last()
        if (voltage >= first.voltage) return 100.0
        if (voltage <= last.voltage) return 0.0

        for (i in 0 until curve.size - 1) {
            val hi = curve[i]
            val lo = curve[i + 1]
            if (voltage <= hi.voltage && voltage >= lo.voltage) {
                val span = hi.voltage - lo.voltage
                val t = if (span > 0.0) (voltage - lo.voltage) / span else 0.0
                return lo.soc + t * (hi.soc - lo.soc)
            }
        }
        return 0.0
    }

    private fun estimateManualBatteryPercent(
        voltageV: Double,
        minVoltage: Double?,
        maxVoltage: Double?,
    ): Double? {
        if (minVoltage == null || maxVoltage == null) return null
        if (maxVoltage <= minVoltage) return null

        val norm = (voltageV - minVoltage) / (maxVoltage - minVoltage)
        if (norm >= 1.0) return 100.0
        if (norm <= 0.0) return 0.0

        for (i in 0 until MANUAL_CURVE.size - 1) {
            val hi = MANUAL_CURVE[i]
            val lo = MANUAL_CURVE[i + 1]
            if (norm <= hi.norm && norm >= lo.norm) {
                val span = hi.norm - lo.norm
                val t = if (span > 0.0) (norm - lo.norm) / span else 0.0
                return lo.soc + t * (hi.soc - lo.soc)
            }
        }
        return 0.0
    }

    private fun computeRPackOhm(resistanceMilliOhm: Int, seriesCount: Int, parallelCount: Int): Double =
        resistanceMilliOhm / 1000.0 * seriesCount / parallelCount

    fun estimateBatteryPercent(
        voltageV: Double,
        config: Map<String, Any?>?,
        batteryCurrentA: Double = 0.0,
    ): Double? {
        val normalized = normalizeBatteryConfig(config) ?: return null
        val mode = normalized["mode"] as? String ?: return null

        return when (mode) {
            "preset" -> {
                val cellPresetId = normalized["cellPresetId"] as? String ?: return null
                val seriesCount = (normalized["seriesCount"] as? Number)?.toInt() ?: return null
                val parallelCount = (normalized["parallelCount"] as? Number)?.toInt() ?: return null
                val preset = presetById[cellPresetId] ?: return null
                val rPackOhm = computeRPackOhm(preset.internalResistanceMilliOhm, seriesCount, parallelCount)
                val correctedV = voltageV + batteryCurrentA * rPackOhm
                interpolateCurve(correctedV / seriesCount, preset.socCurve)
            }
            "manual" -> {
                val minV = (normalized["minVoltage"] as? Number)?.toDouble() ?: return null
                val maxV = (normalized["maxVoltage"] as? Number)?.toDouble() ?: return null
                val estimatedSeries = kotlin.math.round(maxV / 4.2).toInt().coerceAtLeast(1)
                val rPackOhm = computeRPackOhm(DEFAULT_INTERNAL_RESISTANCE_MILLIOHM, estimatedSeries, 2)
                val correctedV = voltageV + batteryCurrentA * rPackOhm
                estimateManualBatteryPercent(correctedV, minV, maxV)
            }
            else -> null
        }
    }
}
