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

/**
 * The board's two light switches on the wrist: the same pair the phone's board drawer shows, in one
 * swipe instead of a pocket. Shares [MoveScreen]'s vocabulary — the centre of the pinned rim circle
 * split across the middle, top half LEDs, bottom half headlight, a glyph per half — and reads
 * differently on purpose: Move tints a half only while it is held, Lights leaves the half tinted
 * and its glyph lit for as long as that switch is on. That resting tint is the state readout.
 *
 * A tap flips the half immediately in a pending style and fires a haptic, then settles when the
 * board's own echo lands on `/board`. Optimistic because the round trip is wrist -> phone -> BLE ->
 * echo -> Data Layer, realistically several hundred milliseconds and worse on a weak link; a switch
 * that sits still that long reads as "didn't register" and gets tapped again. The board still owns
 * the resting state — the local value exists only between the tap and the echo, and
 * [PENDING_TIMEOUT_MS] of silence reverts it, because `setBoardLights` can fail with nothing to
 * say and a tap that changed nothing must not leave a switch claiming it did.
 *
 * Three gates, any one of which dims both halves and makes them inert: a LIVE mirror,
 * `lightsControllable`, and both values known. The LIVE gate is what stops a stale `/board` push
 * from lying — the path persists by design, so a wrist that lost the phone would otherwise keep
 * offering switches over an hour-old truth.
 */
@Composable
fun LightsScreen(sender: CommandSender, interactionEnabled: Boolean = true) {
    val state by TelemetryState.mirrorState
    val lights by BoardState.lights
    val haptics = LocalHapticFeedback.current

    // The rider's own edit, held only until the board echoes it or the timeout gives up on it.
    var pendingLeds by remember { mutableStateOf<Boolean?>(null) }
    var pendingHeadlight by remember { mutableStateOf<Boolean?>(null) }

    val known = lights.lightsEnabled != null && lights.headlightsEnabled != null
    val enabled = state.status == MirrorStatus.LIVE && lights.lightsControllable && known
    val canTap = enabled && interactionEnabled

    // Any echo settles the pending edit, whichever way it went: the board's answer is the truth,
    // including when it answers with the value the rider was trying to change away from.
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
    // Losing a gate mid-flight drops the optimistic value rather than leaving it dimmed but claimed.
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

/**
 * Resting tint per half plus the divider that says the circle splits in two. Same canvas as
 * [MoveScreen]'s split, with the tint meaning "this switch is on" rather than "this half is held";
 * a pending edit draws at a lower alpha so an unsettled tap is visibly not yet the board's answer.
 */
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
        val diameter = minOf(size.width, size.height) - INNER_INSET.toPx() * 2f
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
                // The tint and the haptic are the press feedback; a ripple under the rim arcs is not.
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

/** How long an unechoed tap keeps its pending value before it reverts to the board's own state. */
private const val PENDING_TIMEOUT_MS = 2_000L

/** Clears the rim arcs: the Lights centre lives inside the circle the gauges draw. */
private val INNER_INSET = 14.dp
private val GLYPH_SIZE = 28.dp
private const val DIVIDER_STROKE_PX = 2f
private const val ON_TINT_ALPHA = 0.18f
private const val PENDING_TINT_ALPHA = 0.07f
