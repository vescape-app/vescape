package app.vescape.wear

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

internal const val DASH = "—"

// Palette mirrors src/constants/theme.ts so the watch matches the phone app.
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
internal val NavColor = Color(0xFFA855F7) // purple.color (navigation)
internal val LightsColor = Color(0xFFF59E0B) // amber.color (theme.light.accent, board lights)

/**
 * Nav accent the wrist actually draws with: the rider's own colour when they picked one on the
 * phone, so route, chevron and rider dot match the phone map instead of a hardcoded purple.
 */
@Composable
internal fun navColor(): Color = SettingsState.settings.value.riderColor ?: NavColor
internal val AmbientText = Color(0xFFB8C4CE)

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
