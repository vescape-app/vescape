package app.vescape.wear

import androidx.compose.ui.graphics.Color
import expo.modules.vescapecore.telemetry.TelemetryLevel

internal const val DASH = "—"

// @parity /watch/watchos/Palette.swift `Palette`
internal val PrimaryText = Color(0xFFF1F5F9)
internal val SecondaryText = Color(0xFF94A3B8)
internal val DimText = Color(0xFF64748B)
internal val GuideColor = Color(0xFF334155)
internal val SpeedColor = Color(0xFF38BDF8)
internal val DutyColor = Color(0xFF14B8A6)
internal val MotorTempColor = Color(0xFFEF4444)
internal val CtrlTempColor = Color(0xFFF97316)
internal val BatteryColor = Color(0xFF22C55E)
internal val WarningColor = Color(0xFFF97316)
internal val CriticalColor = Color(0xFFEF4444)
/**
 * @parity /watch/watchos/Palette.swift `trail`
 * @parity /src/constants/theme.ts `accentColors.dark.violet`
 */
internal val TrailColor = Color(0xFF7C6FEF)
/**
 * @parity /src/screens/main/map/NavigationMapLayers.tsx `NAVIGATION_ROUTE_COLOR`
 */
internal val NavColor = Color(0xFFA855F7)
internal val LightsColor = Color(0xFFF59E0B)
internal val TiltColor = Color(0xFF06B6D4)
internal val ArmedColor = Color(0xFFF59E0B)
internal val AmbientText = Color(0xFFB8C4CE)

/**
 * @parity /watch/watchos/Palette.swift `level`
 */
internal fun telemetryLevelColor(level: TelemetryLevel): Color? = when (level) {
    TelemetryLevel.NORMAL -> null
    TelemetryLevel.WARNING -> WarningColor
    TelemetryLevel.CRITICAL -> CriticalColor
}

/**
 * @parity /src/constants/theme.ts `weather`
 */
internal fun weatherColor(slug: String): Color = when (slug) {
    "sun" -> Color(0xFFFBBF24)
    "moon" -> Color(0xFFA78BFA)
    "cloud-sun" -> Color(0xFFF59E0B)
    "cloud-moon" -> Color(0xFF7C6FEF)
    "cloud-fog" -> Color(0xFFCBD5E1)
    "cloud-rain" -> Color(0xFF60A5FA)
    "cloud-snow" -> Color(0xFFBAE6FD)
    "cloud-lightning" -> Color(0xFFC084FC)
    else -> Color(0xFF94A3B8)
}
