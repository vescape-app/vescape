package app.vescape.wear

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitVerticalTouchSlopOrCancellation
import androidx.compose.foundation.gestures.verticalDrag
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlinx.coroutines.delay
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * @parity /watch/watchos/TiltScreen.swift `TiltScreen`
 */
@Composable
fun TiltScreen(
    sender: CommandSender,
    interactionEnabled: Boolean = true,
    onHoldChanged: (Boolean) -> Unit = {},
) {
    val state by TelemetryState.mirrorState
    val settings by SettingsState.settings
    val haptics = LocalHapticFeedback.current
    val density = LocalDensity.current
    val deadzonePx = with(density) { STICK_DEADZONE.toPx() }
    val fullPx = with(density) { STICK_FULL.toPx() }

    val frame = state.frame
    val live = state.status == MirrorStatus.LIVE
    val control = frame?.tiltControl ?: WatchTiltControl.FREE
    val nativeValue = frame?.remoteTilt
    val canDrive = live && nativeValue != null && control.drivable && interactionEnabled
    val canReset = interactionEnabled && nativeValue != null && control != WatchTiltControl.SENSOR
    val driveGate by rememberUpdatedState(canDrive)
    val nativePercent = nativeValue?.let(::tiltPercent) ?: 0f

    var dragging by remember { mutableStateOf(false) }
    var deflection by remember { mutableFloatStateOf(0f) }
    var target by remember { mutableFloatStateOf(0f) }
    var sentValue by remember { mutableStateOf<Int?>(null) }
    var armedAtMs by remember { mutableStateOf<Long?>(null) }
    val resetRing = remember { Animatable(0f) }

    val shownPercent = if (dragging || sentValue != null) target else nativePercent
    val armed = armedAtMs != null

    LaunchedEffect(dragging) {
        onHoldChanged(dragging)
        if (!dragging) return@LaunchedEffect
        armedAtMs = null
        if (sentValue == null) target = nativePercent
        sentValue = null
        var moved = false
        var lastSentMs = 0L
        var notch = notchOf(target)
        var lastMs = withFrameMillis { it }
        try {
            while (true) {
                val now = withFrameMillis { it }
                val rate = stickRatePercentPerSecond(deflection, deadzonePx, fullPx, settings.tiltRatePercent)
                val next = integrateTilt(target, rate, now - lastMs)
                lastMs = now
                if (next == target) continue
                val hitLimit = abs(next) == 100f && abs(target) != 100f
                target = next
                moved = true
                val nextNotch = notchOf(next)
                if (hitLimit) {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                } else if (nextNotch != notch) {
                    haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                }
                notch = nextNotch
                val value = tiltValue(next)
                if (value != sentValue && now - lastSentMs >= SEND_INTERVAL_MS) {
                    sender.sendTiltLock(value)
                    sentValue = value
                    lastSentMs = now
                }
            }
        } finally {
            val value = tiltValue(target)
            if (moved && driveGate && value != sentValue) {
                sender.sendTiltLock(value)
                sentValue = value
            }
        }
    }

    LaunchedEffect(nativeValue, dragging, sentValue) {
        if (dragging || sentValue == null) return@LaunchedEffect
        if (nativeValue == sentValue) {
            sentValue = null
            return@LaunchedEffect
        }
        delay(LOCAL_HOLD_MS)
        sentValue = null
    }

    LaunchedEffect(armedAtMs) {
        if (armedAtMs == null) {
            resetRing.snapTo(0f)
            return@LaunchedEffect
        }
        resetRing.snapTo(1f)
        resetRing.animateTo(0f, tween(RESET_WINDOW_MS.toInt(), easing = LinearEasing))
        armedAtMs = null
    }

    LaunchedEffect(canReset) { if (!canReset) armedAtMs = null }

    DisposableEffect(Unit) {
        onDispose { onHoldChanged(false) }
    }

    val onTap by rememberUpdatedState { nowMs: Long ->
        val armedAt = armedAtMs
        if (armedAt != null && nowMs - armedAt <= RESET_WINDOW_MS) {
            armedAtMs = null
            target = 0f
            sentValue = TILT_CENTER
            sender.sendTiltCancel()
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        } else if (shownPercent.roundToInt() != 0) {
            armedAtMs = nowMs
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        }
    }

    val accent = when {
        armed -> ArmedColor
        !canDrive -> DimText
        shownPercent.roundToInt() != 0 -> TiltColor
        else -> PrimaryText
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(canDrive, canReset) {
                if (!canDrive && !canReset) return@pointerInput
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    if (!canDrive) {
                        val up = waitForUpOrCancellation()
                        if (up != null && up.uptimeMillis - down.uptimeMillis <= TAP_MAX_MS) onTap(up.uptimeMillis)
                        return@awaitEachGesture
                    }
                    val drag = awaitVerticalTouchSlopOrCancellation(down.id) { change, _ -> change.consume() }
                    if (drag == null) {
                        val up = currentEvent.changes.firstOrNull { it.id == down.id }
                        if (up != null && !up.pressed && !up.isConsumed &&
                            up.uptimeMillis - down.uptimeMillis <= TAP_MAX_MS
                        ) {
                            onTap(up.uptimeMillis)
                        }
                        return@awaitEachGesture
                    }
                    val originY = down.position.y
                    deflection = originY - drag.position.y
                    dragging = true
                    try {
                        verticalDrag(drag.id) { change ->
                            deflection = originY - change.position.y
                            change.consume()
                        }
                    } finally {
                        dragging = false
                        deflection = 0f
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        TiltStickCanvas(
            deflectionFraction = { (deflection / fullPx).coerceIn(-1f, 1f) },
            dragging = dragging,
            enabled = canDrive,
            resetFraction = { resetRing.value },
        )
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = SIDE_INSET),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                horizontalAlignment = Alignment.End,
            ) {
                Text(
                    text = "TILT",
                    style = MaterialTheme.typography.caption3,
                    color = DimText,
                )
                Text(
                    text = formatTilt(shownPercent),
                    style = WatchTypography.mono(MaterialTheme.typography.title1),
                    color = accent,
                    maxLines = 1,
                )
            }
            Spacer(modifier = Modifier.width(TRACK_GAP))
            Text(
                text = tiltCaption(
                    live = live,
                    phoneKnowsTilt = nativeValue != null,
                    control = control,
                    armed = armed,
                    tilted = shownPercent.roundToInt() != 0,
                ),
                style = MaterialTheme.typography.caption2,
                color = if (armed) ArmedColor else if (canDrive) SecondaryText else DimText,
                textAlign = TextAlign.Start,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun TiltStickCanvas(
    deflectionFraction: () -> Float,
    dragging: Boolean,
    enabled: Boolean,
    resetFraction: () -> Float,
) {
    val accent = if (enabled) TiltColor else DimText
    Canvas(modifier = Modifier.fillMaxSize()) {
        val center = Offset(size.width / 2f, size.height / 2f)
        val half = minOf(size.width, size.height) / 2f - GAUGE_INNER_INSET.toPx() - TRACK_END_INSET.toPx()
        val stroke = TRACK_STROKE.toPx()

        drawLine(GuideColor, Offset(center.x, center.y - half), Offset(center.x, center.y + half), stroke, StrokeCap.Round)
        val notch = NOTCH_HALF_WIDTH.toPx()
        drawLine(GuideColor, Offset(center.x - notch, center.y), Offset(center.x + notch, center.y), stroke, StrokeCap.Round)

        val knobY = center.y - deflectionFraction() * half
        if (dragging) {
            drawLine(accent, center, Offset(center.x, knobY), stroke * 2f, StrokeCap.Round)
        }
        val knobRadius = KNOB_RADIUS.toPx()
        if (dragging) {
            drawCircle(accent, knobRadius, Offset(center.x, knobY))
        } else {
            drawCircle(accent.copy(alpha = IDLE_KNOB_ALPHA), knobRadius, Offset(center.x, knobY), style = Stroke(stroke))
        }

        val ring = resetFraction()
        if (ring > 0f) {
            val diameter = minOf(size.width, size.height) - GAUGE_INNER_INSET.toPx() * 2f
            drawArc(
                color = ArmedColor,
                startAngle = -90f,
                sweepAngle = 360f * ring,
                useCenter = false,
                topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f),
                size = Size(diameter, diameter),
                style = Stroke(RESET_RING_STROKE.toPx(), cap = StrokeCap.Round),
            )
        }
    }
}

private fun tiltCaption(
    live: Boolean,
    phoneKnowsTilt: Boolean,
    control: WatchTiltControl,
    armed: Boolean,
    tilted: Boolean,
): String = when {
    armed -> "Tap again\nto reset"
    !live -> "Board not\nconnected"
    !phoneKnowsTilt -> "Update\nphone app"
    control == WatchTiltControl.SENSOR -> "Sensor"
    control == WatchTiltControl.MOVE -> "Board moving"
    control == WatchTiltControl.BLOCKED -> "Link not\ntrusted"
    tilted -> "Double-tap\nto reset"
    else -> "Drag up\nor down"
}

private fun notchOf(percent: Float): Int = floor(percent / HAPTIC_NOTCH_PERCENT).toInt()

private val STICK_DEADZONE = 8.dp

private val STICK_FULL = 60.dp

private const val SEND_INTERVAL_MS = 100L

private const val LOCAL_HOLD_MS = 1_500L

private const val RESET_WINDOW_MS = 700L

private const val TAP_MAX_MS = 400L

private const val HAPTIC_NOTCH_PERCENT = 5f

private val SIDE_INSET = 22.dp
private val TRACK_GAP = 36.dp
private val TRACK_END_INSET = 14.dp
private val TRACK_STROKE = 2.dp
private val NOTCH_HALF_WIDTH = 6.dp
private val KNOB_RADIUS = 9.dp
private val RESET_RING_STROKE = 3.dp
private const val IDLE_KNOB_ALPHA = 0.7f
