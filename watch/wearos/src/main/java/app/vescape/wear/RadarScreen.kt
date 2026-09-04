package app.vescape.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/**
 * Rain radar page, above the forecast. The last two hours of observed rain replay over the rider,
 * who sits pinned at the centre exactly as on the nav page, so "is that band going to hit me" is a
 * question the wrist can answer without the phone.
 *
 * Three parts, in the order they are read: the imagery, the rider at the centre, and a curved
 * timeline along the bottom rim — the battery gauge's shape one ring further in, filling as the
 * animation runs, with the frame's own clock time under it.
 *
 * The only wrist surface that fetches for itself (see [RadarState]); it does so only while it is
 * the page on screen.
 */
@Composable
fun RadarScreen(visible: Boolean) {
    val forecast = freshWeather()
    LoadRadar(visible = visible, latitude = forecast?.latitude, longitude = forecast?.longitude)

    // Only frames whose image has arrived: the animation runs over what the watch actually has,
    // and lengthens on its own as the rest land.
    val loaded = RadarState.frames.filter { RadarState.images.containsKey(it.timeSec) }

    if (loaded.isEmpty()) {
        RadarAbsentHint(
            hasLocation = forecast?.latitude != null,
            loading = RadarState.loading,
        )
        return
    }

    var index by remember { mutableIntStateOf(0) }
    // Clamped rather than reset: frames arriving mid-loop must not throw the rider back to the
    // oldest one they already watched.
    val frameIndex = index.coerceIn(0, loaded.lastIndex)
    val frame = loaded[frameIndex]

    // Steps the state itself rather than the value this composition captured: the effect is not
    // re-keyed per frame, so a captured index would advance to the same frame forever.
    LaunchedEffect(visible, loaded.size) {
        if (!visible) return@LaunchedEffect
        while (true) {
            val last = index >= loaded.lastIndex
            delay(if (last) LOOP_HOLD_MS else FRAME_MS)
            index = if (last) 0 else index + 1
        }
    }

    val isRound = LocalConfiguration.current.isScreenRound
    val image = RadarState.images[frame.timeSec]
    val riderColor = navColor()
    val timelineColor = weatherColor("cloud-rain")
    val progress = if (loaded.size <= 1) 1f else frameIndex / (loaded.size - 1).toFloat()
    // How far out each ring sits, as a fraction of the face. A ring is dropped rather than clipped
    // when it does not fit: near the poles a frame covers little ground and the wide ring would be
    // a circle drawn on the bezel.
    val rings = forecast?.latitude?.let { latitude ->
        val rangeM = radarFaceRangeM(latitude)
        RANGE_RING_KM
            .map { km -> km to (km * 1_000.0 / rangeM).toFloat() }
            .filter { (_, fraction) -> fraction <= RING_MAX_FRACTION }
    }.orEmpty()
    val configuration = LocalConfiguration.current
    // The radar runs to the bezel, so its radius is the screen's own — the rim arcs float over it
    // rather than boxing it in. In dp, so the labels can sit on rings the canvas draws in pixels.
    val faceRadiusDp = minOf(configuration.screenWidthDp, configuration.screenHeightDp).dp / 2

    Box(modifier = Modifier.fillMaxSize()) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val faceRadius = size.minDimension / 2f
            val centre = Offset(size.width / 2f, size.height / 2f)
            val faceClip = Path().apply {
                if (isRound) addOval(Rect(centre, faceRadius)) else addRect(Rect(Offset.Zero, size))
            }
            clipPath(faceClip) {
                if (image != null) drawRadar(image, centre, faceRadius)
                // Dashed, so a ring never reads as another gauge guide or as a coastline in the
                // imagery under it.
                val ringStroke = Stroke(
                    width = RING_W.toPx(),
                    pathEffect = PathEffect.dashPathEffect(
                        floatArrayOf(RING_DASH.toPx(), RING_GAP.toPx()),
                    ),
                )
                for ((_, fraction) in rings) {
                    drawCircle(GuideColor, faceRadius * fraction, centre, style = ringStroke)
                }
                drawRider(centre, riderColor)
            }
            drawTimeline(centre, size.minDimension / 2f, progress, timelineColor)
        }
        // Out to the right of the rider: the page header owns the top, and a horizontal radius
        // keeps the labels off the imagery the rider is actually reading ahead of them.
        for ((km, fraction) in rings) {
            Text(
                // Unit on the outermost ring only: the inner one reads as the same scale without
                // repeating it next to a line 10 dp away.
                text = if (km == rings.last().first) "$km km" else "$km",
                style = MaterialTheme.typography.caption3.copy(fontSize = RING_FONT_SIZE),
                color = DimText,
                modifier = Modifier
                    .align(Alignment.Center)
                    .offset(x = faceRadiusDp * fraction - RING_LABEL_INSET),
            )
        }
        RadarHeader()
        Text(
            text = formatHour(minuteOfDay(frame.timeSec * 1_000L)),
            style = MaterialTheme.typography.caption2,
            color = SecondaryText,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = TIME_BOTTOM_PADDING),
        )
    }
}

/**
 * The imagery, square and centred on the rider, scaled to cover the face. Dimmed: it is a backdrop
 * for the rider and the timeline, not the brightest thing on a screen read in sunlight.
 */
private fun DrawScope.drawRadar(image: ImageBitmap, centre: Offset, faceRadius: Float) {
    val side = (faceRadius * 2f).roundToInt()
    drawImage(
        image = image,
        srcOffset = IntOffset.Zero,
        srcSize = IntSize(image.width, image.height),
        dstOffset = IntOffset((centre.x - faceRadius).roundToInt(), (centre.y - faceRadius).roundToInt()),
        dstSize = IntSize(side, side),
        alpha = RADAR_ALPHA,
    )
}

/** "You are here", drawn exactly like the nav page's rider so the two pages read as one map. */
private fun DrawScope.drawRider(centre: Offset, color: Color) {
    drawCircle(Color.Black, radius = RIDER_DOT_R.toPx(), centre)
    drawCircle(color, radius = RIDER_DOT_R.toPx(), centre, style = Stroke(width = RIDER_RING_W.toPx()))
}

/**
 * The battery gauge's bottom arc, one ring inside it and a little shorter, filling from the oldest
 * frame to the newest. Butt caps and a hair of width, like every other arc on the wrist — nothing
 * here is drawn as a pill. Its own ring rather than the rim so it never reads as another board value.
 */
private fun DrawScope.drawTimeline(centre: Offset, faceRadius: Float, progress: Float, color: Color) {
    val radius = faceRadius - TIMELINE_INSET.toPx()
    val topLeft = Offset(centre.x - radius, centre.y - radius)
    val arcSize = Size(radius * 2f, radius * 2f)
    drawArc(
        GuideColor,
        TIMELINE_START,
        -TIMELINE_SWEEP,
        false,
        topLeft,
        arcSize,
        style = Stroke(width = TIMELINE_GUIDE_W.toPx(), cap = StrokeCap.Butt),
    )
    drawArc(
        color,
        TIMELINE_START,
        -TIMELINE_SWEEP * progress.coerceIn(0f, 1f),
        false,
        topLeft,
        arcSize,
        style = Stroke(width = TIMELINE_FILL_W.toPx(), cap = StrokeCap.Butt),
    )
}

/** Names the page, since a radar frame alone is not obviously one. */
@Composable
private fun BoxScope.RadarHeader() {
    Column(
        modifier = Modifier.align(Alignment.TopCenter).padding(top = HEADER_TOP_PADDING),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_ph_target),
            contentDescription = null,
            tint = weatherColor("cloud-rain"),
            modifier = Modifier.size(HEADER_ICON_SIZE),
        )
        Text(
            text = "Rain radar",
            style = MaterialTheme.typography.caption3.copy(fontSize = HEADER_FONT_SIZE),
            color = SecondaryText,
        )
    }
}

/** Why the page is empty: the phone has not said where the rider is, or the fetch got nothing. */
@Composable
private fun RadarAbsentHint(hasLocation: Boolean, loading: Boolean) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = if (loading) "Loading radar" else "No radar",
            style = MaterialTheme.typography.body2,
            color = SecondaryText,
            textAlign = TextAlign.Center,
        )
        if (!loading) {
            Text(
                text = if (hasLocation) "Watch has no network" else "Waiting for your phone",
                style = MaterialTheme.typography.caption3.copy(fontSize = HINT_FONT_SIZE),
                color = DimText,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

/** Two hours of frames in about six seconds: fast enough to read as motion, slow enough to follow. */
private const val FRAME_MS = 450L

/** The newest frame is the one worth looking at, so the loop pauses on it before starting over. */
private const val LOOP_HOLD_MS = 1_600L

/** Dim enough that the rider and the timeline stay the brightest things on the page. */
private const val RADAR_ALPHA = 0.75f

/** Distance rings, the scale that turns a band of rain into "twenty minutes away". */
private val RANGE_RING_KM = listOf(50, 100)
private const val RING_MAX_FRACTION = 0.95f
private val RING_W = 1.dp
private val RING_DASH = 3.dp
private val RING_GAP = 4.dp
private val RING_FONT_SIZE = 7.sp

/** Labels sit just inside their ring rather than on the line. */
private val RING_LABEL_INSET = 10.dp

private val HEADER_TOP_PADDING = 12.dp
private val HEADER_ICON_SIZE = 14.dp
private val HEADER_FONT_SIZE = 9.sp

private val RIDER_DOT_R = 4.dp
private val RIDER_RING_W = 2.dp

/** Inside the battery arc's ring, so the two never touch. */
private val TIMELINE_INSET = 20.dp
private const val TIMELINE_START = 130f
private const val TIMELINE_SWEEP = 80f
private val TIMELINE_GUIDE_W = 1.dp
private val TIMELINE_FILL_W = 2.dp
private val TIME_BOTTOM_PADDING = 34.dp
private val HINT_FONT_SIZE = 11.sp
