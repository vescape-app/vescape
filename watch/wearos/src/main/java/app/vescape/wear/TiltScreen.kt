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
 * Remote Tilt from the wrist, driven like a drone's rate stick: touch anywhere, drag up or down, and
 * the tilt keeps changing for as long as the thumb stays deflected — faster the further it goes, up
 * to the rider's `tiltRatePercent` per second. Letting go leaves the tilt where it is: every change
 * is sent as an absolute Remote Tilt *lock*, which the phone holds until a reset, whatever happens
 * to the wrist afterwards.
 *
 * A double tap resets through the phone pad's cancel, which eases back to neutral rather than
 * snapping. The first tap only arms it — a tick, an amber readout and a draining ring say the next
 * tap resets — so a stray touch never drops a tilt the rider was riding on.
 *
 * The readout is the phone's commanded value from the Watch Frame, so a tilt set or cleared on the
 * phone pad shows here and is where the next drag starts. While a thumb is on the stick, and until
 * the phone reports the last lock back, it shows the wrist's own value instead so it never lags.
 *
 * Vertical drags belong to this page: the vertical pager is off on control pages, and a drag that
 * goes horizontal first is left to the control pager, so the rider can still swipe away.
 *
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
    // A phone without the tilt lanes drops tilt commands too, so its frames drive nothing.
    val canDrive = live && nativeValue != null && control.drivable && interactionEnabled
    // Reset is the rider's way out and stays ungated like the phone's cancel: a stale frame or an
    // untrusted link still takes it. Only a bound sensor, which re-takes the slot, makes it moot.
    val canReset = interactionEnabled && nativeValue != null && control != WatchTiltControl.SENSOR
    val driveGate by rememberUpdatedState(canDrive)
    val nativePercent = nativeValue?.let(::tiltPercent) ?: 0f

    var dragging by remember { mutableStateOf(false) }
    /** Thumb travel from where it touched down, px, positive up. */
    var deflection by remember { mutableFloatStateOf(0f) }
    /** The wrist's own tilt while it is steering, percent. */
    var target by remember { mutableFloatStateOf(0f) }
    /** The last lock sent, until the phone reports it back (or gives up on it). */
    var sentValue by remember { mutableStateOf<Int?>(null) }
    var armedAtMs by remember { mutableStateOf<Long?>(null) }
    val resetRing = remember { Animatable(0f) }

    val shownPercent = if (dragging || sentValue != null) target else nativePercent
    val armed = armedAtMs != null

    // The drag itself: integrate the stick every frame, send the lock whenever it lands on a new
    // wire value, at most every SEND_INTERVAL_MS. Keyed on the drag, so the last value is sent when
    // the thumb lifts even if it fell inside the throttle window.
    LaunchedEffect(dragging) {
        onHoldChanged(dragging)
        if (!dragging) return@LaunchedEffect
        armedAtMs = null
        // Seed from what the readout shows: right after a release or a reset the phone's value still
        // trails the wrist's, and starting from it would step the board back to where it was.
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
                // A tick per notch lets the rider count steps without looking; the end stop thuds.
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
            // A drag cut short because the page stopped being drivable says nothing the phone
            // should act on; only a thumb lifting on a live, drivable page sends its last value.
            if (moved && driveGate && value != sentValue) {
                sender.sendTiltLock(value)
                sentValue = value
            }
        }
    }

    // Hand the readout back to the phone once it echoes the last lock — or after a grace period,
    // because a refused lock is never echoed and the wrist must not keep claiming a tilt it lost.
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
            // Show neutral at once and hold it until the phone's ease reports back, so a drag started
            // mid-ease seeds from neutral, not from the tilt that was just reset.
            target = 0f
            sentValue = TILT_CENTER
            sender.sendTiltCancel()
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        } else if (shownPercent.roundToInt() != 0) {
            // Nothing to reset at neutral, so a tap there arms nothing and says nothing.
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
                        // Read-only stick: taps still reach the reset, drags belong to the pager.
                        val up = waitForUpOrCancellation()
                        if (up != null && up.uptimeMillis - down.uptimeMillis <= TAP_MAX_MS) onTap(up.uptimeMillis)
                        return@awaitEachGesture
                    }
                    // Only a drag that goes vertical first is the stick's; one that goes sideways is
                    // left unconsumed for the control pager, and one that never moves is a tap.
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
                        // Also runs when the page loses its gate mid-drag and this input restarts.
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
        // The track owns the full height, so the readout flanks it: number left, hint right, both
        // on the widest row of the round screen.
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

/**
 * The stick, drawn: a vertical track with the thumb's deflection as a knob, a fill from centre to
 * knob, and — while a reset is armed — an amber ring inside the rim gauges draining to zero.
 * Lambdas are read in the draw scope, so a drag repaints without recomposing.
 */
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
        // Nearly the whole height, stopping short of the rim gauges.
        val half = minOf(size.width, size.height) / 2f - GAUGE_INNER_INSET.toPx() - TRACK_END_INSET.toPx()
        val stroke = TRACK_STROKE.toPx()

        drawLine(GuideColor, Offset(center.x, center.y - half), Offset(center.x, center.y + half), stroke, StrokeCap.Round)
        // Neutral notch across the track: where a still thumb sits.
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

/** Why the stick is dead, or what the next touch does. */
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

/** Nothing moves inside this: a resting thumb must not creep. */
private val STICK_DEADZONE = 8.dp

/** Deflection at which the stick reaches the rider's full rate. */
private val STICK_FULL = 60.dp

/** Lock spacing while dragging; the phone's own tilt tick is 100 ms, so faster buys nothing. */
private const val SEND_INTERVAL_MS = 100L

/** How long the wrist keeps showing an un-echoed lock before trusting the phone's value again. */
private const val LOCAL_HOLD_MS = 1_500L

/** Second-tap window after the first tap arms a reset. */
private const val RESET_WINDOW_MS = 700L

/** A press held longer than this is not a tap. */
private const val TAP_MAX_MS = 400L

/** One haptic tick per this many percent of tilt. */
private const val HAPTIC_NOTCH_PERCENT = 5f

private val SIDE_INSET = 22.dp
/** Clear width around the track: the knob plus breathing room on each side. */
private val TRACK_GAP = 36.dp
private val TRACK_END_INSET = 14.dp
private val TRACK_STROKE = 2.dp
private val NOTCH_HALF_WIDTH = 6.dp
private val KNOB_RADIUS = 9.dp
private val RESET_RING_STROKE = 3.dp
private const val IDLE_KNOB_ALPHA = 0.7f
