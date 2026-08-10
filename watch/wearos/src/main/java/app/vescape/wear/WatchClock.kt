package app.vescape.wear

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import java.util.Calendar
import kotlinx.coroutines.delay

/**
 * Wall clock for the Watch Frame: the mirror runs fullscreen, so the system time is hidden while
 * riding. Always 24h, matching the frame's metric-only readouts. Minute resolution only — the tick
 * sleeps to the next minute boundary instead of polling, so an idle wrist costs one recomposition
 * per minute.
 */
@Composable
internal fun WatchClock(modifier: Modifier = Modifier, color: Color = SecondaryText) {
    var text by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        while (true) {
            val now = Calendar.getInstance()
            text = String.format("%02d:%02d", now.get(Calendar.HOUR_OF_DAY), now.get(Calendar.MINUTE))
            val msIntoMinute = now.get(Calendar.SECOND) * 1_000L + now.get(Calendar.MILLISECOND)
            delay(60_000L - msIntoMinute)
        }
    }

    Text(
        text = text,
        style = MaterialTheme.typography.caption2,
        color = color,
        modifier = modifier,
    )
}
