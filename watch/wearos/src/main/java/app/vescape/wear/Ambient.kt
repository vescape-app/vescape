package app.vescape.wear

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * How the Mirror renders while the watch is in ambient (always-on) mode.
 *
 * Ambient is not a separate screen: the same [FrameLayout] draws, in the same places, so waking the
 * wrist is a state change on a live tree rather than a swap between two layouts. What changes is
 * which lanes are allowed to claim a value, and how the claim is drawn.
 *
 * Every lane keeps its last reading, and colour is what says how much to trust it. The phone drops
 * to a 5 s ambient push and the wrist repaints on `AMBIENT_REFRESH_INTERVAL_MS`, so battery and
 * temperatures are still exact at that cadence and are drawn as [readout]s, while speed and duty may
 * be up to a tick behind the wrist and are drawn as [skeleton]s — the same grey the layout uses for
 * a lane with nothing in it. Grey and a real number reads as "a moment ago", which is both true and
 * more use to a rider than an empty gauge. A frame that has stopped arriving is the one case with
 * nothing to say, and empties every lane to a dash.
 *
 * [lowBit] and [burnInProtection] come from the ambient callback and describe the panel: a low-bit
 * screen has no usable colour palette, and a burn-in-prone one needs the centre content to move.
 */
internal data class AmbientMode(
    val active: Boolean = false,
    val lowBit: Boolean = false,
    val burnInProtection: Boolean = false,
)

/** The normal, screen-on case. */
internal val AmbientOff = AmbientMode()

/** Colour for a reading ambient is willing to stand behind. */
internal fun AmbientMode.readout(color: Color): Color = when {
    !active -> color
    lowBit -> Color.White
    else -> AmbientText
}

/** Colour for a reading ambient is showing but will not vouch for as current. */
internal fun AmbientMode.skeleton(color: Color): Color = if (active) DimText else color

/**
 * Gradient wedge strength. Ambient draws flat strokes only: the fills are lit pixels, which is what
 * both the battery and the burn-in budget are spent on.
 */
internal fun AmbientMode.glow(strength: Float): Float = if (active) 0f else strength

/**
 * Slow pixel shift for burn-in-prone panels, applied to everything inside the rim. Only the centre
 * content moves; the arcs are thin and near-symmetric, so nailing them down keeps the layout stable
 * while the numbers wander.
 */
@Composable
internal fun AmbientMode.burnInOffset(): DpOffset {
    if (!active || !burnInProtection) return DpOffset.Zero
    // Phase runs off the wall clock, not off entry: a wrist that wakes and sleeps every minute would
    // otherwise restart at step zero every time and burn the one position it was meant to spread.
    var step by remember { mutableIntStateOf(burnInStep()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(BURN_IN_SHIFT_INTERVAL_MS - System.currentTimeMillis() % BURN_IN_SHIFT_INTERVAL_MS)
            step = burnInStep()
        }
    }
    return BURN_IN_STEPS[step]
}

private fun burnInStep(): Int =
    ((System.currentTimeMillis() / BURN_IN_SHIFT_INTERVAL_MS) % BURN_IN_STEPS.size).toInt()

private const val BURN_IN_SHIFT_INTERVAL_MS = 60_000L

/** A small square walk: every pixel under a glyph gets a rest within four shifts. */
private val BURN_IN_STEPS = listOf(
    DpOffset(0.dp, 0.dp),
    DpOffset(3.dp, (-3).dp),
    DpOffset(0.dp, (-6).dp),
    DpOffset((-3).dp, (-3).dp),
)
