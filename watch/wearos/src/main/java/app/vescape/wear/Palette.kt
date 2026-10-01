package app.vescape.wear

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import expo.modules.vescapecore.telemetry.TelemetryLevel

internal const val DASH = "—"

// Palette mirrors src/constants/theme.ts so the watch matches the phone app.
// @parity /watch/watchos/Palette.swift `Palette`
internal val PrimaryText = Color(0xFFF1F5F9) // slate.textPrimary
internal val SecondaryText = Color(0xFF94A3B8) // slate.textSecondary
internal val DimText = Color(0xFF64748B) // slate.textMuted
internal val GuideColor = Color(0xFF334155) // slate.border
internal val SpeedColor = Color(0xFF38BDF8) // sky.color
internal val DutyColor = Color(0xFF14B8A6) // teal.color
internal val MotorTempColor = Color(0xFFEF4444) // red.color (motorTemp)
internal val CtrlTempColor = Color(0xFFF97316) // orange.color (controllerTemp)
internal val BatteryColor = Color(0xFF22C55E) // green.color
internal val WarningColor = Color(0xFFF97316) // orange.color
internal val CriticalColor = Color(0xFFEF4444) // red.color (status.error)
/** Phone live-trail violet, used until the Rider chooses a colour.
 * @parity /watch/watchos/Palette.swift `trail`
 * @parity /src/constants/theme.ts `accentColors.dark.violet`
 */
internal val TrailColor = Color(0xFF7C6FEF)
internal val NavColor = Color(0xFFA855F7) // purple.color (navigation)
internal val LightsColor = Color(0xFFF59E0B) // amber.color (theme.light.accent, board lights)
internal val TiltColor = Color(0xFF06B6D4) // cyan.color (Remote Tilt)
internal val ArmedColor = Color(0xFFF59E0B) // amber.color (a reset one tap away)

/**
 * Nav accent the wrist actually draws with: the rider's own colour when they picked one on the
 * phone, so route, chevron and rider dot match the phone map instead of a hardcoded purple.
 */
@Composable
internal fun navColor(): Color = SettingsState.settings.value.riderColor ?: NavColor

@Composable
internal fun trailColor(): Color = SettingsState.settings.value.riderColor ?: TrailColor
internal val AmbientText = Color(0xFFB8C4CE)

/**
 * A level the phone classified, as its colour; normal has none, so the caller keeps its own.
 *
 * @parity /watch/watchos/Palette.swift `level`
 */
internal fun telemetryLevelColor(level: TelemetryLevel): Color? = when (level) {
    TelemetryLevel.NORMAL -> null
    TelemetryLevel.WARNING -> WarningColor
    TelemetryLevel.CRITICAL -> CriticalColor
}

/**
 * Condition tints, keyed by the icon slug the phone resolves. Mirrors `theme.weather`; the phone
 * owns which WMO code is which condition, each renderer owns what that condition looks like.
 *
 * @parity /src/constants/theme.ts `weather`
 */
internal fun weatherColor(slug: String): Color = when (slug) {
    "sun" -> Color(0xFFFBBF24) // amber.light
    "moon" -> Color(0xFFA78BFA) // violet.moon
    "cloud-sun" -> Color(0xFFF59E0B) // amber.color
    "cloud-moon" -> Color(0xFF7C6FEF) // violet.color
    "cloud-fog" -> Color(0xFFCBD5E1) // slate.text
    "cloud-rain" -> Color(0xFF60A5FA) // blue.color
    "cloud-snow" -> Color(0xFFBAE6FD) // sky.snow
    "cloud-lightning" -> Color(0xFFC084FC) // purple.thunder
    else -> Color(0xFF94A3B8) // slate.light
}
