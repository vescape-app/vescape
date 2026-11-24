package app.vescape.wear

import expo.modules.vescapecore.telemetry.UnitPresentation
import expo.modules.vescapecore.watch.WATCH_RADAR_TILE_ZOOM
import expo.modules.vescapecore.watch.WatchMapPosition
import expo.modules.vescapecore.watch.tileCoordinates

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
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.font.FontWeight
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
 * @parity /watch/watchos/RadarScreen.swift
 */
@Composable
fun RadarScreen(visible: Boolean) {
    val forecast = freshWeather()
    LoadRadar(visible = visible, latitude = forecast?.latitude, longitude = forecast?.longitude)

    val loaded = RadarState.frames.filter { RadarState.images.containsKey(it.timeSec) }

    if (loaded.isEmpty()) {
        RadarAbsentHint(
            hasLocation = forecast?.latitude != null,
            loading = RadarState.loading,
        )
        return
    }

    var index by remember { mutableIntStateOf(0) }
    val frameIndex = index.coerceIn(0, loaded.lastIndex)
    val frame = loaded[frameIndex]

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
    val imageCentre = RadarState.imageCentre
    val streetMapEnabled = SettingsState.settings.value.streetMapEnabled
    val timelineColor = weatherColor("cloud-rain")
    val progress = if (loaded.size <= 1) 1f else frameIndex / (loaded.size - 1).toFloat()
    val rings = imageCentre?.first?.let { latitude ->
        val rangeM = radarFaceRangeM(latitude)
        RANGE_RING_KM
            .map { km -> km to (km * 1_000.0 / rangeM).toFloat() }
            .filter { (_, fraction) -> fraction <= RING_MAX_FRACTION }
    }.orEmpty()
    val configuration = LocalConfiguration.current
    val labelShadowPx = with(LocalDensity.current) { 2.dp.toPx() }
    val faceRadiusDp = minOf(configuration.screenWidthDp, configuration.screenHeightDp).dp / 2

    Box(modifier = Modifier.fillMaxSize()) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val faceRadius = size.minDimension / 2f
            val centre = Offset(size.width / 2f, size.height / 2f)
            val faceClip = Path().apply {
                if (isRound) addOval(Rect(centre, faceRadius)) else addRect(Rect(Offset.Zero, size))
            }
            clipPath(faceClip) {
                if (streetMapEnabled && imageCentre != null) {
                    drawRadarMap(centre, faceRadius * 2, WatchMapPosition(imageCentre.first, imageCentre.second))
                }
                if (image != null) drawRadar(image, centre, faceRadius)
                val ringStroke = Stroke(
                    width = RING_W.toPx(),
                    pathEffect = PathEffect.dashPathEffect(
                        floatArrayOf(RING_DASH.toPx(), RING_GAP.toPx()),
                    ),
                )
                for ((_, fraction) in rings) {
                    drawCircle(SecondaryText.copy(alpha = 0.6f), faceRadius * fraction, centre, style = ringStroke)
                }
                drawRiderDot(centre, NavColor)
            }
            drawTimeline(centre, size.minDimension / 2f, progress, timelineColor)
        }
        for ((km, fraction) in rings) {
            Text(
                text = if (SettingsState.settings.value.distanceUnit == "mi") UnitPresentation.distance(km * 1000.0, "mi") else "${km}km",
                style = WatchTypography.mono(MaterialTheme.typography.caption3.copy(
                    fontSize = RING_FONT_SIZE,
                    shadow = Shadow(color = Color.Black, blurRadius = labelShadowPx),
                )),
                color = PrimaryText,
                modifier = Modifier
                    .align(Alignment.Center)
                    .offset(x = faceRadiusDp * fraction),
            )
        }
        RadarHeader()
        Text(
            text = formatHour(minuteOfDay(frame.timeSec * 1_000L), SettingsState.settings.value.timeFormat),
            style = WatchTypography.mono(MaterialTheme.typography.caption2.copy(
                fontWeight = FontWeight.SemiBold,
                shadow = Shadow(color = Color.Black, blurRadius = labelShadowPx),
            )),
            color = PrimaryText,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = TIME_BOTTOM_PADDING),
        )
    }
}

// @parity /watch/watchos/RadarScreen.swift `drawRadarMap`
private fun DrawScope.drawRadarMap(centre: Offset, side: Float, position: WatchMapPosition) {
    MapTileState.decodedVersion.intValue
    val n = 1 shl WATCH_RADAR_TILE_ZOOM
    val (x, y) = tileCoordinates(position, n)
    val placements = MapTileState.held.value.keys.mapNotNull { tile ->
        if (tile.z != WATCH_RADAR_TILE_ZOOM) return@mapNotNull null
        val dx = ((tile.x - x + n * 1.5) % n) - n / 2.0
        val dy = tile.y - y
        if (dx !in -1.5..0.5 || dy !in -1.5..0.5) return@mapNotNull null
        tile to Offset(centre.x + (dx.toFloat() * side), centre.y + (dy.toFloat() * side))
    }
    val tiles = MapTileState.frame(placements.map { it.first }).draw.toSet()
    for ((tile, origin) in placements) {
        if (tile !in tiles) continue
        val image = MapTileState.image(tile) ?: continue
        val left = origin.x.roundToInt()
        val top = origin.y.roundToInt()
        drawImage(
            image = image,
            alpha = BASEMAP_ALPHA,
            dstOffset = IntOffset(left, top),
            dstSize = IntSize((origin.x + side).roundToInt() - left, (origin.y + side).roundToInt() - top),
        )
    }
}

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

private const val FRAME_MS = 450L

private const val LOOP_HOLD_MS = 1_600L

private const val RADAR_ALPHA = 0.75f

// @parity /src/modules/weather/components/RadarRangeRings.tsx `RANGE_RING_KM`
private val RANGE_RING_KM = listOf(50, 100)
private const val RING_MAX_FRACTION = 0.95f
private const val BASEMAP_ALPHA = 0.75f
private val RING_W = 1.5.dp
private val RING_DASH = 3.dp
private val RING_GAP = 3.dp
private val RING_FONT_SIZE = 8.sp


private val HEADER_TOP_PADDING = 12.dp
private val HEADER_ICON_SIZE = 14.dp
private val HEADER_FONT_SIZE = 9.sp

private val TIMELINE_INSET = 20.dp
private const val TIMELINE_START = 130f
private const val TIMELINE_SWEEP = 80f
private val TIMELINE_GUIDE_W = 1.dp
private val TIMELINE_FILL_W = 2.dp
private val TIME_BOTTOM_PADDING = 34.dp
private val HINT_FONT_SIZE = 11.sp
