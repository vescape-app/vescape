package app.vescape.wear

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlin.math.absoluteValue

/**
 * @parity /watch/watchos/StatusLayouts.swift `DisconnectedLayout`
 */
@Composable
internal fun DisconnectedLayout(notice: LinkNotice, ambient: AmbientMode) {
    val (title, caption) = when (notice) {
        LinkNotice.CONNECTING -> "Connecting…" to ""
        LinkNotice.NO_PHONE -> "Phone not connected" to ""
        LinkNotice.APP_MISSING -> "Phone app missing" to "Install or update Vescape"
    }
    StatusLayout(title = title, caption = caption, ambient = ambient)
}

@Composable
private fun ProbePulse(ambient: AmbientMode) {
    val probe by TelemetryState.linkProbe
    val sweep = remember { Animatable(PULSE_SETTLED) }
    var pulsed by remember { mutableIntStateOf(probe.count) }

    LaunchedEffect(probe.count, ambient.active) {
        if (ambient.active) {
            sweep.snapTo(PULSE_SETTLED)
            pulsed = probe.count
            return@LaunchedEffect
        }
        if (probe.count == pulsed) return@LaunchedEffect
        pulsed = probe.count
        sweep.snapTo(0f)
        sweep.animateTo(PULSE_SETTLED, tween(durationMillis = PULSE_MS, easing = LinearEasing))
    }

    Row(horizontalArrangement = Arrangement.spacedBy(PULSE_DOT_GAP)) {
        repeat(PULSE_DOTS) { index ->
            val distance = (sweep.value - index).absoluteValue
            val lit = (1f - distance).coerceIn(0f, 1f)
            Box(
                modifier = Modifier
                    .size(PULSE_DOT_SIZE)
                    .clip(CircleShape)
                    .background(ambient.skeleton(GuideColor).copy(alpha = PULSE_DIM + lit * (1f - PULSE_DIM))),
            )
        }
    }
}

@Composable
private fun StatusLayout(title: String, caption: String, ambient: AmbientMode) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier
                .padding(horizontal = STATUS_SIDE_INSET),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.title3.copy(fontSize = STATUS_TITLE_FONT_SIZE),
                color = ambient.readout(PrimaryText),
                textAlign = TextAlign.Center,
            )
            if (caption.isNotEmpty()) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = caption,
                    style = MaterialTheme.typography.caption2,
                    color = ambient.skeleton(SecondaryText),
                    textAlign = TextAlign.Center,
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            ProbePulse(ambient)
        }
    }
}

private val STATUS_TITLE_FONT_SIZE = 15.sp

private val STATUS_SIDE_INSET = 44.dp

private const val PULSE_DOTS = 3
private const val PULSE_MS = 900
private const val PULSE_DIM = 0.35f

private const val PULSE_SETTLED = PULSE_DOTS.toFloat()

private val PULSE_DOT_SIZE = 4.dp
private val PULSE_DOT_GAP = 5.dp
