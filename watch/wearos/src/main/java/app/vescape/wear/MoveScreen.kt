package app.vescape.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextAlign
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlinx.coroutines.delay

/** Forward is the top half, backward the bottom — the same order as the phone's Move board card. */
private const val DIRECTION_FORWARD = 1
private const val DIRECTION_BACKWARD = -1

/**
 * Board Move from the wrist: one circle split across the middle, top half forward, bottom half back.
 * Hold to roll, release to stop — the same action as the phone's Move board card, reaching the same
 * native Board Move stream (ADR-0033), so the board behaves identically whichever the rider presses.
 *
 * A hold is a stream of ticks, not a press/release pair. Releasing sends an immediate stop, but the
 * stop the rider's safety actually rests on is the phone's dead-man: stop ticking and the board
 * stops, so a wrist that walks out of Bluetooth range mid-hold cannot leave the board rolling.
 *
 * Only enabled on a LIVE mirror. A stale or absent frame means the phone has no fresh board
 * telemetry, and a Move nobody can see the result of is not one to offer.
 */
@Composable
fun MoveScreen(
    sender: CommandSender,
    interactionEnabled: Boolean = true,
    onHoldChanged: (Boolean) -> Unit = {},
) {
    val state by TelemetryState.mirrorState
    val settings by SettingsState.settings
    val enabled = state.status == MirrorStatus.LIVE
    val canMove = enabled && interactionEnabled
    val haptics = LocalHapticFeedback.current

    // Press state, not a raw pointer gesture: a hold that turns into a horizontal drag is a page
    // swipe, and the interaction source cancels the press for us when the pager claims it. Owning
    // the pointer instead would trap the rider on this page.
    val forward = remember { MutableInteractionSource() }
    val backward = remember { MutableInteractionSource() }
    val forwardPressed by forward.collectIsPressedAsState()
    val backwardPressed by backward.collectIsPressedAsState()
    val held = when {
        // Losing the mirror ends the hold: a stream started while LIVE must not keep ticking
        // against a phone that can no longer show what the board is doing.
        !canMove -> 0
        forwardPressed -> DIRECTION_FORWARD
        backwardPressed -> DIRECTION_BACKWARD
        else -> 0
    }

    LaunchedEffect(held) {
        onHoldChanged(held != 0)
        if (held == 0) {
            sender.sendMove(0)
            return@LaunchedEffect
        }
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        while (true) {
            sender.sendMove(held)
            delay(MOVE_REPEAT_MS)
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            onHoldChanged(false)
            sender.sendMove(0)
        }
    }

    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        MoveDial(held = held, enabled = enabled)
        Column(modifier = Modifier.fillMaxSize()) {
            MoveHalf(
                glyph = "\u25B2",
                enabled = canMove,
                interactionSource = forward,
                modifier = Modifier.weight(1f),
            )
            MoveHalf(
                glyph = "\u25BC",
                enabled = canMove,
                interactionSource = backward,
                modifier = Modifier.weight(1f),
            )
        }
        CenterLabel(enabled = enabled, strengthPercent = settings.boardMoveStrengthPercent)
    }
}

/**
 * The dial itself: a thin ring split by the divider, plus a dim tint on whichever half is held.
 * Nothing bright and filled — the wrist follows the phone's rule that accents are borders, glyphs
 * and text (docs/design.md).
 */
@Composable
private fun MoveDial(held: Int, enabled: Boolean) {
    val accent = if (enabled) SpeedColor else GuideColor
    Canvas(modifier = Modifier.fillMaxSize()) {
        val diameter = minOf(size.width, size.height) - RING_INSET_PX
        val topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f)
        val arcSize = Size(diameter, diameter)

        if (held != 0) {
            drawArc(
                color = accent.copy(alpha = HELD_TINT_ALPHA),
                startAngle = if (held == DIRECTION_FORWARD) 180f else 0f,
                sweepAngle = 180f,
                useCenter = true,
                topLeft = topLeft,
                size = arcSize,
            )
        }

        drawArc(
            color = accent,
            startAngle = 0f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = topLeft,
            size = arcSize,
            style = Stroke(width = RING_STROKE_PX),
        )
        // Split in two so the divider does not strike through the label sitting on it.
        val midY = size.height / 2f
        val gap = size.width * DIVIDER_GAP_FRACTION / 2f
        drawLine(
            color = GuideColor,
            start = Offset(topLeft.x, midY),
            end = Offset(size.width / 2f - gap, midY),
            strokeWidth = RING_STROKE_PX,
        )
        drawLine(
            color = GuideColor,
            start = Offset(size.width / 2f + gap, midY),
            end = Offset(topLeft.x + diameter, midY),
            strokeWidth = RING_STROKE_PX,
        )
    }
}

@Composable
private fun MoveHalf(
    glyph: String,
    enabled: Boolean,
    interactionSource: MutableInteractionSource,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .clickable(
                interactionSource = interactionSource,
                // The hold is the action; a tap that lands and lifts is a hold too short to matter.
                indication = null,
                enabled = enabled,
                onClick = {},
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = glyph,
            style = MaterialTheme.typography.display1,
            color = if (enabled) SpeedColor else DimText,
        )
    }
}

@Composable
private fun CenterLabel(enabled: Boolean, strengthPercent: Int?) {
    val text = when {
        !enabled -> "Board not connected"
        strengthPercent != null -> "$strengthPercent%"
        else -> "Hold to move"
    }
    Text(
        text = text,
        style = MaterialTheme.typography.caption2,
        color = if (enabled) SecondaryText else DimText,
        textAlign = TextAlign.Center,
    )
}

private const val RING_INSET_PX = 12f
private const val RING_STROKE_PX = 2f
private const val HELD_TINT_ALPHA = 0.18f
private const val DIVIDER_GAP_FRACTION = 0.5f
