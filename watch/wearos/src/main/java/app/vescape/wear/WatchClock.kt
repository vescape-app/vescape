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

@Composable
internal fun WatchClock(modifier: Modifier = Modifier, color: Color = SecondaryText) {
    val timeFormat = SettingsState.settings.value.timeFormat
    var text by remember { mutableStateOf("") }

    LaunchedEffect(timeFormat) {
        while (true) {
            val now = Calendar.getInstance()
            text = formatHour(now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE), timeFormat)
            val msIntoMinute = now.get(Calendar.SECOND) * 1_000L + now.get(Calendar.MILLISECOND)
            delay(60_000L - msIntoMinute)
        }
    }

    Text(
        text = text,
        style = WatchTypography.mono(MaterialTheme.typography.caption2),
        color = color,
        modifier = modifier,
    )
}
