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
 * @parity /watch/watchos/AmbientMode.swift `AmbientMode`
 */
internal data class AmbientMode(
    val active: Boolean = false,
    val lowBit: Boolean = false,
    val burnInProtection: Boolean = false,
)

internal val AmbientOff = AmbientMode()

internal fun AmbientMode.readout(color: Color): Color = when {
    !active -> color
    lowBit -> Color.White
    else -> AmbientText
}

internal fun AmbientMode.skeleton(color: Color): Color = if (active) DimText else color

internal fun AmbientMode.glow(strength: Float): Float = if (active) 0f else strength

@Composable
internal fun AmbientMode.burnInOffset(): DpOffset {
    if (!active || !burnInProtection) return DpOffset.Zero
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

private val BURN_IN_STEPS = listOf(
    DpOffset(0.dp, 0.dp),
    DpOffset(3.dp, (-3).dp),
    DpOffset(0.dp, (-6).dp),
    DpOffset((-3).dp, (-3).dp),
)
