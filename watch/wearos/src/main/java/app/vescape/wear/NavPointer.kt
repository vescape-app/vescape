package app.vescape.wear

import expo.modules.vescapecore.telemetry.UnitPresentation

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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlin.math.cos
import kotlin.math.sin

/**
 * @parity /watch/watchos/NavPointer.swift `NavPointer`
 */
@Composable
internal fun NavPointer(
    bearingDeg: Double,
    distanceM: Double,
    muted: Boolean,
    focus: () -> Float = { 0f },
    stackAlpha: () -> Float = { 1f },
    trailing: @Composable () -> Unit = {},
) {
    val color = if (muted) DimText else NavColor

    if (SettingsState.settings.value.navArrowEnabled) {
        Canvas(modifier = Modifier.fillMaxSize().graphicsLayer { alpha = stackAlpha() }) {
            val grow = 1f + CHEVRON_FOCUS_GROWTH * focus()
            val center = Offset(size.width / 2f, size.height / 2f)
            val ring = size.minDimension / 2f - NAV_RIM_INSET.toPx()
            val at = pointOnCircle(center, ring, bearingDeg.toFloat() - 90f)
            rotate(bearingDeg.toFloat(), at) {
                drawChevron(at, CHEVRON_W.toPx() * grow, CHEVRON_H.toPx() * grow, color)
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(bottom = NAV_READOUT_BOTTOM_PAD)
            .graphicsLayer {
                val f = focus()
                alpha = stackAlpha()
                translationY = f * READOUT_FOCUS_DROP.toPx()
                scaleX = 1f + READOUT_FOCUS_GROWTH * f
                scaleY = scaleX
            },
        verticalArrangement = Arrangement.Bottom,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Canvas(modifier = Modifier.size(PIN_BOX)) {
                drawMapPin(Offset(size.width / 2f, size.height / 2f), size.minDimension * 0.74f, color)
            }
            Text(
                text = UnitPresentation.distance(distanceM, SettingsState.settings.value.distanceUnit),
                modifier = Modifier.padding(start = PIN_GAP),
                style = WatchTypography.mono(MaterialTheme.typography.caption2.copy(fontSize = NAV_READOUT_FONT_SIZE)),
                color = color,
            )
            trailing()
        }
    }
}

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

private fun DrawScope.drawMapPin(at: Offset, size: Float, color: Color) {
    val head = size * 0.36f
    val headCenter = Offset(at.x, at.y - size * 0.5f + head)
    val strokeWidth = 1.4.dp.toPx()
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

private val NAV_RIM_INSET = 30.dp
internal val NAV_READOUT_BOTTOM_PAD = 46.dp
private const val CHEVRON_FOCUS_GROWTH = 0.18f
private val READOUT_FOCUS_DROP = 6.dp
private const val READOUT_FOCUS_GROWTH = 0.25f
private val CHEVRON_W = 26.dp
private val CHEVRON_H = 22.dp
private val PIN_BOX = 11.dp
private val PIN_GAP = 3.dp
internal val NAV_READOUT_FONT_SIZE = 12.sp
