package app.vescape.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Navigation overlay on the Watch Frame: a hollow chevron riding just inside the rim at the target's
 * bearing (relative to travel direction, so "up" is straight ahead), plus a map-pin and the
 * remaining distance above the battery %. Nav has no slot of its own — it floats over the gauges,
 * and the whole overlay is absent unless the phone actually sent nav lanes, so a rider without a
 * destination sees the plain telemetry frame.
 */
@Composable
internal fun NavPointer(bearingDeg: Double, distanceM: Double, muted: Boolean) {
    val color = if (muted) DimText else navColor()

    Canvas(modifier = Modifier.fillMaxSize()) {
        val center = Offset(size.width / 2f, size.height / 2f)
        val ring = size.minDimension / 2f - NAV_RIM_INSET.toPx()
        val at = pointOnCircle(center, ring, bearingDeg.toFloat() - 90f)
        rotate(bearingDeg.toFloat(), at) { drawChevron(at, CHEVRON_W.toPx(), CHEVRON_H.toPx(), color) }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(bottom = NAV_READOUT_BOTTOM_PAD),
        verticalArrangement = Arrangement.Bottom,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Glyph is inset inside its canvas so the stroke never clips at the edges.
            Canvas(modifier = Modifier.size(PIN_BOX)) {
                drawMapPin(Offset(size.width / 2f, size.height / 2f), size.minDimension * 0.74f, color)
            }
            Text(
                text = distanceLabel(distanceM),
                modifier = Modifier.padding(start = PIN_GAP),
                style = MaterialTheme.typography.caption2.copy(fontSize = DISTANCE_FONT_SIZE),
                color = color,
            )
        }
    }
}

/** Wide hollow chevron over a translucent fill. Points up before rotation, centred on [at]. */
private fun DrawScope.drawChevron(at: Offset, width: Float, height: Float, color: Color) {
    val halfW = width / 2f
    val halfH = height / 2f
    val notch = height * 0.34f
    val outline = Path().apply {
        moveTo(at.x, at.y - halfH)
        lineTo(at.x + halfW, at.y + halfH * 0.28f)
        lineTo(at.x + halfW, at.y + halfH)
        lineTo(at.x, at.y + halfH - notch)
        lineTo(at.x - halfW, at.y + halfH)
        lineTo(at.x - halfW, at.y + halfH * 0.28f)
        close()
    }
    drawPath(outline, color.copy(alpha = 0.22f))
    drawPath(outline, color, style = Stroke(width = 1.6.dp.toPx(), join = StrokeJoin.Round, cap = StrokeCap.Round))
}

/** Map-pin glyph: stroked head, two tail lines to the tip, filled centre dot. */
private fun DrawScope.drawMapPin(at: Offset, size: Float, color: Color) {
    val head = size * 0.36f
    val headCenter = Offset(at.x, at.y - size * 0.5f + head)
    val strokeWidth = 1.4.dp.toPx()
    // Head arc gap sits at the bottom (canvas y is down), where the two tail lines take over.
    drawArc(
        color = color,
        startAngle = 145f,
        sweepAngle = 250f,
        useCenter = false,
        topLeft = Offset(headCenter.x - head, headCenter.y - head),
        size = Size(head * 2f, head * 2f),
        style = Stroke(width = strokeWidth, cap = StrokeCap.Round, join = StrokeJoin.Round),
    )
    val tip = Offset(at.x, at.y + size * 0.5f)
    drawLine(color, pointOnCircle(headCenter, head, 35f), tip, strokeWidth = strokeWidth, cap = StrokeCap.Round)
    drawLine(color, pointOnCircle(headCenter, head, 145f), tip, strokeWidth = strokeWidth, cap = StrokeCap.Round)
    drawCircle(color, radius = head * 0.34f, center = headCenter)
}

private fun DrawScope.pointOnCircle(center: Offset, radius: Float, deg: Float): Offset {
    val rad = Math.toRadians(deg.toDouble())
    return Offset(center.x + (radius * cos(rad)).toFloat(), center.y + (radius * sin(rad)).toFloat())
}

/** Metres under a kilometre, one decimal above it — same split the phone's nav readout uses. */
private fun distanceLabel(meters: Double): String =
    if (meters < 1000) "${meters.roundToInt()} m" else String.format("%.1f km", meters / 1000.0)

private val NAV_RIM_INSET = 30.dp
// Sits in the band between the rider dot and the battery %.
private val NAV_READOUT_BOTTOM_PAD = 46.dp
private val CHEVRON_W = 26.dp
private val CHEVRON_H = 22.dp
private val PIN_BOX = 11.dp
private val PIN_GAP = 3.dp
private val DISTANCE_FONT_SIZE = 12.sp
