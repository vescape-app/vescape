package app.vescape.wear

import android.os.SystemClock
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlinx.coroutines.delay

/**
 * Field-debuggable view of the frame path ([WatchDiagnostics]), one pager page right of the gauges.
 * Readable straight off the wrist — no adb, and no phone round trip (the wrist->phone channel in
 * ADR-0033 carries rider commands, never diagnostics): counters answer "are frames arriving / decoding", the event ring shows link flaps and streak
 * starts with wall-clock times a rider can report or photograph.
 */
@Composable
fun DiagnosticsScreen() {
    val counters by WatchDiagnostics.counters
    val events by WatchDiagnostics.events
    val link by TelemetryState.phoneLink

    // Local clock tick so "last frame Xs ago" keeps counting while no new frames redraw the page.
    var nowMs by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1_000L)
            nowMs = SystemClock.elapsedRealtime()
        }
    }

    ScalingLazyColumn(modifier = Modifier.fillMaxSize()) {
        item {
            Text(
                text = "Diagnostics",
                style = MaterialTheme.typography.title3,
                color = PrimaryText,
                textAlign = TextAlign.Center,
            )
        }
        item { StatLine("Link", link.name) }
        item { StatLine("Frames", counters.framesDecoded.toString()) }
        item { StatLine("Last frame", lastFrameLabel(counters.lastFrameAtMs, nowMs)) }
        item { StatLine("Decode fails", counters.decodeFailures.toString(), warn = counters.decodeFailures > 0) }
        if (counters.unknownPathMessages > 0) {
            item { StatLine("Other msgs", counters.unknownPathMessages.toString(), warn = true) }
        }
        item {
            Spacer(modifier = Modifier.height(6.dp))
        }
        if (events.isEmpty()) {
            item {
                Text(
                    text = "No events yet",
                    style = MaterialTheme.typography.caption2,
                    color = DimText,
                    textAlign = TextAlign.Center,
                )
            }
        } else {
            items(events) { event -> EventLine(event) }
        }
    }
}

@Composable
private fun StatLine(label: String, value: String, warn: Boolean = false) {
    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp)) {
        Text(
            text = label,
            style = MaterialTheme.typography.caption2,
            color = SecondaryText,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = value,
            style = MaterialTheme.typography.caption2,
            color = if (warn) WarningColor else PrimaryText,
        )
    }
}

@Composable
private fun EventLine(event: DiagnosticEvent) {
    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        Text(
            text = event.time,
            style = MaterialTheme.typography.caption3,
            color = DimText,
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = event.text,
            style = MaterialTheme.typography.caption3,
            color = if (event.warn) WarningColor else SecondaryText,
            modifier = Modifier.weight(1f),
        )
    }
}

private fun lastFrameLabel(lastFrameAtMs: Long?, nowMs: Long): String {
    if (lastFrameAtMs == null) return "never"
    return "${((nowMs - lastFrameAtMs).coerceAtLeast(0L)) / 1000}s ago"
}
