package app.vescape.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlin.math.sqrt

/**
 * The Group Ride page, one swipe below nav focus, mounted only while the Rider is joined: every
 * other Rider nearest first, one row each — colour dot, name, an arrow to where they are relative to
 * the Rider's course, distance, and one status slot ([groupRideStatus]). Alone, it says so.
 *
 * Up to [GROUP_PAGE_ROWS] rows, centred on the face. Past that, the crown steps the window a row at
 * a time; the vertical swipe stays the pager's. The nav map and readout are hidden under this page
 * by the caller. Ambient parks the pager on the gauges, so this is never drawn there.
 *
 * @parity /watch/watchos/GroupRidePage.swift `GroupRidePage`
 * @platform-diff The pager here does not take the crown, so the list owns it outright; watchOS pages
 *   with the crown and hands it to the list only while this page is settled. Rows are clamped to the
 *   round face's chord here, to the display less the rim inset on watchOS.
 */
@Composable
internal fun GroupRidePage() {
    val group = GroupRideState.group.value ?: return
    val rows = group.roster()
    val unitSystem = SettingsState.settings.value.unitSystem
    var first by remember { mutableIntStateOf(0) }
    var crownPx by remember { mutableFloatStateOf(0f) }
    val maxFirst = (rows.size - GROUP_PAGE_ROWS).coerceAtLeast(0)
    // A Rider leaving can shorten the list under the window.
    val start = first.coerceIn(0, maxFirst)
    val stepPx = with(LocalDensity.current) { GROUP_ROW_H.toPx() }
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .onRotaryScrollEvent { event ->
                // One row per row-height of crown travel, accumulated so a slow turn still steps.
                crownPx += event.verticalScrollPixels
                val steps = (crownPx / stepPx).toInt()
                if (steps != 0) {
                    crownPx -= steps * stepPx
                    first = (start + steps).coerceIn(0, maxFirst)
                }
                true
            }
            .focusRequester(focusRequester)
            .focusable(),
    ) {
        val visible = rows.subList(start, minOf(rows.size, start + GROUP_PAGE_ROWS))
        val limit = minOf(maxWidth, maxHeight) / 2 * GROUP_PAGE_SAFE_RADIUS
        val bodyH = if (rows.isEmpty()) GROUP_ROW_H else GROUP_ROW_H * visible.size
        val blockH = GROUP_TITLE_H + GROUP_TITLE_GAP + bodyH
        val rowsTop = -blockH / 2 + GROUP_TITLE_H + GROUP_TITLE_GAP

        Column(modifier = Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(modifier = Modifier.height(GROUP_TITLE_H), contentAlignment = Alignment.Center) {
                Text(
                    text = "Group · ${rows.size}",
                    style = MaterialTheme.typography.caption2.copy(fontSize = GROUP_TITLE_FONT),
                    color = SecondaryText,
                    textAlign = TextAlign.Center,
                )
            }
            Spacer(modifier = Modifier.height(GROUP_TITLE_GAP))
            if (rows.isEmpty()) {
                Box(modifier = Modifier.height(GROUP_ROW_H), contentAlignment = Alignment.Center) {
                    Text(
                        text = "Waiting for riders",
                        style = MaterialTheme.typography.caption1.copy(fontSize = GROUP_NAME_FONT),
                        color = DimText,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            visible.forEachIndexed { i, row ->
                // Fixed width, narrowed to the safe circle's chord at the row's centre line.
                val mid = (rowsTop + GROUP_ROW_H * i + GROUP_ROW_H / 2).value
                val half = sqrt((limit.value * limit.value - mid * mid).coerceAtLeast(0f))
                GroupRideRowView(row, unitSystem, minOf(GROUP_ROW_W, (half * 2).dp))
            }
        }
    }
}

@Composable
private fun GroupRideRowView(row: GroupRideRow, unitSystem: String, width: Dp) {
    val stale = row.status == GroupRideStatus.Lost
    Row(
        modifier = Modifier
            .width(width)
            .height(GROUP_ROW_H)
            .graphicsLayer { alpha = if (stale) GROUP_STALE_ROW_ALPHA else 1f },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val dotColor = Color(row.rider.colorArgb)
        Canvas(modifier = Modifier.size(GROUP_ROW_DOT)) { drawCircle(dotColor) }
        Text(
            text = row.name,
            style = MaterialTheme.typography.caption1.copy(fontSize = GROUP_NAME_FONT),
            color = PrimaryText,
            maxLines = 1,
            overflow = TextOverflow.Clip,
            modifier = Modifier.padding(start = 4.dp, end = 2.dp).weight(1f),
        )
        Canvas(modifier = Modifier.size(GROUP_ARROW_BOX)) {
            rotate(row.bearingDeg.toFloat()) { drawBearingArrow(SecondaryText) }
        }
        Text(
            text = groupRideDistanceLabel(row.rider.distanceM, unitSystem),
            style = WatchTypography.mono(MaterialTheme.typography.caption2.copy(fontSize = GROUP_VALUE_FONT)),
            color = PrimaryText,
            textAlign = TextAlign.End,
            maxLines = 1,
            modifier = Modifier.width(GROUP_DISTANCE_W),
        )
        Spacer(modifier = Modifier.width(3.dp))
        Box(modifier = Modifier.width(GROUP_STATUS_W), contentAlignment = Alignment.CenterEnd) {
            StatusSlot(row.status)
        }
    }
}

@Composable
private fun StatusSlot(status: GroupRideStatus) {
    val style = WatchTypography.mono(MaterialTheme.typography.caption2.copy(fontSize = GROUP_VALUE_FONT))
    when (status) {
        GroupRideStatus.Lost -> Text(text = "lost", style = style, color = DimText)
        GroupRideStatus.NoBoard -> Text(text = DASH, style = style, color = DimText)
        is GroupRideStatus.Hot -> {
            val color = levelColor(status.level) ?: SecondaryText
            Canvas(modifier = Modifier.size(GROUP_THERMOMETER_W, GROUP_THERMOMETER_H)) {
                drawThermometer(color, Offset.Zero, Size(size.width, size.height))
            }
        }
        is GroupRideStatus.Battery -> Text(
            text = "${status.percent}%",
            style = style,
            color = levelColor(status.level) ?: SecondaryText,
        )
    }
}

/** Filled arrow pointing up (straight ahead) before rotation, centred in the canvas. */
private fun DrawScope.drawBearingArrow(color: Color) {
    val c = Offset(size.width / 2f, size.height / 2f)
    val h = size.minDimension * 0.42f
    val w = size.minDimension * 0.30f
    val path = Path().apply {
        moveTo(c.x, c.y - h)
        lineTo(c.x + w, c.y + h)
        lineTo(c.x, c.y + h * 0.45f)
        lineTo(c.x - w, c.y + h)
        close()
    }
    drawPath(path, color)
}

/**
 * Rows on screen before the crown scrolls the list.
 *
 * @parity /watch/watchos/GroupRidePage.swift `GROUP_PAGE_ROWS`
 */
private const val GROUP_PAGE_ROWS = 5

/** Each row's width is clamped to the chord of this share of the face radius at its centre line. */
private const val GROUP_PAGE_SAFE_RADIUS = 0.8f
private val GROUP_ROW_H = 22.dp
private val GROUP_ROW_W = 150.dp
private val GROUP_TITLE_H = 14.dp
private val GROUP_TITLE_GAP = 4.dp
private val GROUP_TITLE_FONT = 11.sp
private val GROUP_NAME_FONT = 13.sp
private val GROUP_VALUE_FONT = 11.sp
private val GROUP_ROW_DOT = 6.dp
private val GROUP_ARROW_BOX = 10.dp
private val GROUP_DISTANCE_W = 48.dp
private val GROUP_STATUS_W = 30.dp
private val GROUP_THERMOMETER_W = 6.dp
private val GROUP_THERMOMETER_H = 12.dp
/** A lost Rider's row: there, but plainly not current. */
private const val GROUP_STALE_ROW_ALPHA = 0.4f
