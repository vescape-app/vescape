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
import androidx.compose.runtime.remember
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
 * No fresh frames: name the reason from the watch-local [PhoneLink], so a dead Bluetooth link, a
 * missing phone app and an idle one are distinguishable at a glance.
 *
 * Each title names the thing that is missing rather than the state of the chain, in the rider's
 * words and not the enum's: the failure is always one broken step in watch → phone → board, and the
 * last of those is not about the phone at all. Titles that differ only in a word ("No phone link" /
 * "Phone linked") read as the same shape on a round screen at arm's length.
 *
 * This draws inside the gauge shell, not instead of it. The shell drops its speed and duty heroes
 * while disconnected, so the reason owns the centre of the circle rather than dodging two dashes.
 */
@Composable
internal fun DisconnectedLayout(ambient: AmbientMode) {
    val link by TelemetryState.phoneLink
    val (title, caption) = when (link) {
        PhoneLink.UNKNOWN -> "Connecting…" to ""
        // The title already says it. "Check Bluetooth" was the only fix a rider could try, and
        // they try it without being told.
        PhoneLink.NO_PHONE -> "Phone not connected" to ""
        // The capability is absent when the app is missing *or* too old, so the caption has to
        // cover both; naming only one of them sends half the riders down the wrong path.
        PhoneLink.PHONE_ONLY -> "Phone app missing" to "Install or update Vescape"
        PhoneLink.APP_REACHABLE -> "Board not connected" to "Connect it on your phone"
    }
    StatusLayout(title = title, caption = caption, ambient = ambient)
}

/**
 * Proof that the watch is still looking, driven by the monitor's real 5 s node/capability query
 * ([PhoneLinkMonitor]) rather than by a free-running clock. A decorative spinner turns at sixty
 * frames a second while the watch checks twice a minute; this lights once per actual probe, so a row
 * that has gone still means the poll loop itself died — the thing worth seeing.
 *
 * Ambient gets the dots at rest: an always-on panel cannot pay for a permanent animation, and the
 * probe drops to a minute apart there anyway.
 */
@Composable
private fun ProbePulse(ambient: AmbientMode) {
    val probe by TelemetryState.linkProbe
    val sweep = remember { Animatable(PULSE_SETTLED) }

    LaunchedEffect(probe.count, ambient.active) {
        if (ambient.active || probe.count == 0) return@LaunchedEffect
        sweep.snapTo(0f)
        sweep.animateTo(PULSE_SETTLED, tween(durationMillis = PULSE_MS, easing = LinearEasing))
    }

    Row(horizontalArrangement = Arrangement.spacedBy(PULSE_DOT_GAP)) {
        repeat(PULSE_DOTS) { index ->
            // The lit point travels across the row once per probe, then every dot settles back to
            // the same dim: at rest the row says "idle", not "stuck mid-animation".
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

/**
 * The reason, centred inside the rim arcs. No progress ring: the gauge shell already draws a circle
 * at the rim, and a second spinning one inside it read as a competing gauge rather than as waiting.
 */
@Composable
private fun StatusLayout(title: String, caption: String, ambient: AmbientMode) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            // Pushed below the hero units: the centre of the circle is where "km/h" and "%" live,
            // and the reason has to sit in the free band under them rather than across them.
            modifier = Modifier
                // Kept inside the inner circle: at full width a one-line title runs straight
                // through the curved MOTOR and CTRL labels sitting on the rim.
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


/** Smaller than a stock title: this sits between the rim arcs, not on an empty screen. */
private val STATUS_TITLE_FONT_SIZE = 15.sp

private val STATUS_SIDE_INSET = 44.dp

/** Probe pulse: a lit point crossing a short row of dots, once per completed query. */
private const val PULSE_DOTS = 3
private const val PULSE_MS = 900
private const val PULSE_DIM = 0.35f

/** Where the travelling point rests between probes: past the last dot, so the row settles even. */
private const val PULSE_SETTLED = PULSE_DOTS.toFloat()

private val PULSE_DOT_SIZE = 4.dp
private val PULSE_DOT_GAP = 5.dp
