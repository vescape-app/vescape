package app.vescape.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlinx.coroutines.delay

@Composable
fun LightsScreen(sender: CommandSender, interactionEnabled: Boolean = true) {
    val state by TelemetryState.mirrorState
    val lights by BoardState.lights
    val haptics = LocalHapticFeedback.current

    var pendingLeds by remember { mutableStateOf<Boolean?>(null) }
    var pendingHeadlight by remember { mutableStateOf<Boolean?>(null) }

    val known = lights.lightsEnabled != null && lights.headlightsEnabled != null
    val enabled = state.status == MirrorStatus.LIVE && lights.lightsControllable && known
    val canTap = enabled && interactionEnabled

    LaunchedEffect(lights.lightsEnabled) { pendingLeds = null }
    LaunchedEffect(lights.headlightsEnabled) { pendingHeadlight = null }
    LaunchedEffect(pendingLeds) {
        if (pendingLeds == null) return@LaunchedEffect
        delay(PENDING_TIMEOUT_MS)
        pendingLeds = null
    }
    LaunchedEffect(pendingHeadlight) {
        if (pendingHeadlight == null) return@LaunchedEffect
        delay(PENDING_TIMEOUT_MS)
        pendingHeadlight = null
    }
    LaunchedEffect(enabled) {
        if (!enabled) {
            pendingLeds = null
            pendingHeadlight = null
        }
    }

    val ledsOn = pendingLeds ?: lights.lightsEnabled ?: false
    val headlightOn = pendingHeadlight ?: lights.headlightsEnabled ?: false

    fun flip(switch: LightSwitch, target: Boolean) {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        when (switch) {
            LightSwitch.LEDS -> pendingLeds = target
            LightSwitch.HEADLIGHT -> pendingHeadlight = target
        }
        sender.sendLights(switch, target)
    }

    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        LightsSplit(
            topOn = ledsOn,
            bottomOn = headlightOn,
            topPending = pendingLeds != null,
            bottomPending = pendingHeadlight != null,
            enabled = enabled,
        )
        Column(modifier = Modifier.fillMaxSize()) {
            LightsHalf(
                iconRes = R.drawable.ic_ph_lightbulb,
                label = "Lights",
                on = ledsOn,
                enabled = enabled,
                onTap = { flip(LightSwitch.LEDS, !ledsOn) }.takeIf { canTap },
                modifier = Modifier.weight(1f),
            )
            LightsHalf(
                iconRes = R.drawable.ic_ph_headlights,
                label = "Headlight",
                on = headlightOn,
                enabled = enabled,
                onTap = { flip(LightSwitch.HEADLIGHT, !headlightOn) }.takeIf { canTap },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun LightsSplit(
    topOn: Boolean,
    bottomOn: Boolean,
    topPending: Boolean,
    bottomPending: Boolean,
    enabled: Boolean,
) {
    val accent = if (enabled) LightsColor else GuideColor
    Canvas(modifier = Modifier.fillMaxSize()) {
        val diameter = minOf(size.width, size.height) - GAUGE_INNER_INSET.toPx() * 2f
        val topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f)
        val arcSize = Size(diameter, diameter)

        fun half(on: Boolean, pending: Boolean, startAngle: Float) {
            if (!on) return
            drawArc(
                color = accent.copy(alpha = if (pending) PENDING_TINT_ALPHA else ON_TINT_ALPHA),
                startAngle = startAngle,
                sweepAngle = 180f,
                useCenter = true,
                topLeft = topLeft,
                size = arcSize,
            )
        }
        half(topOn, topPending, 180f)
        half(bottomOn, bottomPending, 0f)

        drawLine(
            color = GuideColor,
            start = Offset(topLeft.x, size.height / 2f),
            end = Offset(topLeft.x + diameter, size.height / 2f),
            strokeWidth = DIVIDER_STROKE_PX,
        )
    }
}

@Composable
private fun LightsHalf(
    iconRes: Int,
    label: String,
    on: Boolean,
    enabled: Boolean,
    onTap: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val tint: Color = when {
        !enabled -> DimText
        on -> LightsColor
        else -> SecondaryText
    }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                enabled = onTap != null,
                onClick = { onTap?.invoke() },
            ),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                painter = painterResource(iconRes),
                contentDescription = label,
                tint = tint,
                modifier = Modifier.size(GLYPH_SIZE),
            )
            Text(text = label, style = MaterialTheme.typography.caption2, color = tint)
        }
    }
}

private const val PENDING_TIMEOUT_MS = 2_000L

private val GLYPH_SIZE = 28.dp
private const val DIVIDER_STROKE_PX = 2f
private const val ON_TINT_ALPHA = 0.18f
private const val PENDING_TINT_ALPHA = 0.07f
