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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlinx.coroutines.delay

private const val DIRECTION_FORWARD = 1
private const val DIRECTION_BACKWARD = -1

/**
 * @parity /watch/watchos/MoveScreen.swift `MoveScreen`
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

    val forward = remember { MutableInteractionSource() }
    val backward = remember { MutableInteractionSource() }
    val forwardPressed by forward.collectIsPressedAsState()
    val backwardPressed by backward.collectIsPressedAsState()
    val held = when {
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
        MoveSplit(held = held, enabled = enabled)
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
        CenterLabel(
            enabled = enabled,
            strengthPercent = settings.boardMoveStrengthPercent,
            clearsTilt = state.frame?.tiltControl == WatchTiltControl.MANUAL,
        )
    }
}

@Composable
private fun MoveSplit(held: Int, enabled: Boolean) {
    val accent = if (enabled) SpeedColor else GuideColor
    Canvas(modifier = Modifier.fillMaxSize()) {
        val diameter = minOf(size.width, size.height) - GAUGE_INNER_INSET.toPx() * 2f
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

        val midY = size.height / 2f
        val gap = size.width * DIVIDER_GAP_FRACTION / 2f
        drawLine(
            color = GuideColor,
            start = Offset(topLeft.x, midY),
            end = Offset(size.width / 2f - gap, midY),
            strokeWidth = DIVIDER_STROKE_PX,
        )
        drawLine(
            color = GuideColor,
            start = Offset(size.width / 2f + gap, midY),
            end = Offset(topLeft.x + diameter, midY),
            strokeWidth = DIVIDER_STROKE_PX,
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
private fun CenterLabel(enabled: Boolean, strengthPercent: Int?, clearsTilt: Boolean) {
    val text = when {
        !enabled -> "Board not connected"
        strengthPercent != null -> "$strengthPercent%"
        else -> "Hold to move"
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = text,
            style = MaterialTheme.typography.caption2,
            color = if (enabled) SecondaryText else DimText,
            textAlign = TextAlign.Center,
        )
        if (enabled && clearsTilt) {
            Text(
                text = "Clears tilt",
                style = MaterialTheme.typography.caption3,
                color = ArmedColor,
                textAlign = TextAlign.Center,
            )
        }
    }
}

private const val DIVIDER_STROKE_PX = 2f
private const val HELD_TINT_ALPHA = 0.18f
private const val DIVIDER_GAP_FRACTION = 0.5f
