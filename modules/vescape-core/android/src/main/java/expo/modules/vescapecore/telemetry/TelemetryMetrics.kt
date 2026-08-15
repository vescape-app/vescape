package expo.modules.vescapecore.telemetry

internal data class TelemetryMetricDef(
    val controlId: String,
    val unit: String,
    val decimals: Int,
    val alertAbove: Boolean = true,
    /**
     * How far back past its threshold, in this metric's own unit, a fired single-threshold Alert
     * Rule must travel before it can announce again. Sized so ordinary jitter around the threshold
     * cannot re-announce, while a real recovery can.
     */
    val alertRearmMargin: Double,
)

// @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `telemetryMetricDefs`

internal val TELEMETRY_METRIC_DEFS = listOf(
    TelemetryMetricDef("speed",           "km/h", 0, alertRearmMargin = 3.0),
    TelemetryMetricDef("battery",         "V",    1, alertAbove = false, alertRearmMargin = 10.0),
    TelemetryMetricDef("duty",            "%",    0, alertRearmMargin = 5.0),
    TelemetryMetricDef("motor-temp",      "°C",   0, alertRearmMargin = 3.0),
    TelemetryMetricDef("motor-current",   "A",    0, alertRearmMargin = 5.0),
    TelemetryMetricDef("controller-temp", "°C",   0, alertRearmMargin = 3.0),
    TelemetryMetricDef("batt-current",    "A",    0, alertRearmMargin = 5.0),
    TelemetryMetricDef("imu",             "°",    1, alertRearmMargin = 2.0),
)

internal val telemetryMetricByControlId: Map<String, TelemetryMetricDef> =
    TELEMETRY_METRIC_DEFS.associateBy { it.controlId }

internal fun TelemetryMetricDef.formatValue(value: Double): String =
    if (decimals == 0) "%.0f".format(value) else "%.${decimals}f".format(value)

internal fun TelemetryMetricDef.formatValueWithUnit(value: Double): String =
    "${formatValue(value)}$unit"
