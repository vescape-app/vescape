package app.vescape.wear

import androidx.compose.animation.core.AnimationState
import androidx.compose.animation.core.DecayAnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateTo
import androidx.compose.animation.core.calculateTargetValue
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.rememberSplineBasedDecay
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.FlingBehavior
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.ScrollScope
import androidx.compose.foundation.gestures.scrollable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
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
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.PositionIndicatorState
import androidx.wear.compose.material.PositionIndicatorVisibility
import androidx.wear.compose.material.Text
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sqrt
import kotlinx.coroutines.launch

/**
 * The Group Ride page, one swipe below nav focus, mounted only while the Rider is joined: every
 * other Rider nearest first, one row each — colour dot, name, an arrow to where they are relative to
 * the Rider's course, distance, and one status slot ([groupRideStatus]). Alone, it says so.
 *
 * Up to [GROUP_PAGE_ROWS] rows, centred on the face. Past that the list scrolls under a fixed
 * five-row window: a vertical drag moves it with the finger and flings, settling on a whole row, and
 * the crown steps it a row at a time once this page has [settled]. The list takes the drag first
 * (nested scroll): a drag that begins at its top — or any drag when it fits — passes what the list
 * cannot use to the vertical pager, so the page swipes back to nav focus from the top. A flick back
 * up the list stops at its top instead of carrying on to nav focus. A position arc on
 * the right shows where the window sits. The nav map and readout are hidden under this page by the
 * caller. Ambient parks the pager on the gauges, so this is never drawn there.
 *
 * @parity /watch/watchos/GroupRidePage.swift `GroupRidePage`
 * @platform-diff The pager here does not take the crown, so the settled list owns it even when it
 *   fits; watchOS pages with the crown and hands it over only when the list scrolls. Rows are clamped
 *   to the round face's chord at their live centre line here, to the display less the rim inset on
 *   watchOS. Compose hands a pull past the list's top to the pager as it happens; watchOS pages
 *   back once that pull is released.
 */
@Composable
internal fun GroupRidePage(settled: Boolean) {
    val group = GroupRideState.group.value ?: return
    val rows = group.roster()
    val unitSystem = SettingsState.settings.value.unitSystem
    // The list's travel in px: 0 shows the nearest Riders, maxValue the last window. A Rider leaving
    // shortens the list, and ScrollState clamps the offset with it.
    val scroll = rememberScrollState()
    val scope = rememberCoroutineScope()
    val stepPx = with(LocalDensity.current) { GROUP_ROW_H.toPx() }
    val decay = rememberSplineBasedDecay<Float>()
    val fling = remember(scroll, stepPx, decay) { RowSnapFling(scroll, stepPx, decay) }
    val handOff = remember(scroll) { TopHandOff(scroll) }
    val maxFirst = (rows.size - GROUP_PAGE_ROWS).coerceAtLeast(0)
    var crownPx by remember { mutableFloatStateOf(0f) }
    // The row the crown last aimed at, so steps taken mid-slide add up rather than restart.
    var crownRow by remember { mutableIntStateOf(0) }
    val focusRequester = remember { FocusRequester() }
    val total by rememberUpdatedState(rows.size)
    val indicator = remember(scroll) { GroupWindowIndicatorState(scroll) { total } }
    LaunchedEffect(settled) { if (settled) focusRequester.requestFocus() }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .onRotaryScrollEvent { event ->
                // One row per row-height of crown travel, accumulated so a slow turn still steps.
                crownPx += event.verticalScrollPixels
                val steps = (crownPx / stepPx).toInt()
                if (steps != 0) {
                    crownPx -= steps * stepPx
                    val from = if (scroll.isScrollInProgress) crownRow else (scroll.value / stepPx).roundToInt()
                    crownRow = (from + steps).coerceIn(0, maxFirst)
                    scope.launch { scroll.animateScrollTo((crownRow * stepPx).roundToInt(), tween(GROUP_STEP_MS)) }
                }
                true
            }
            .focusRequester(focusRequester)
            .focusable(enabled = settled)
            // The whole page drags the list: up shows further Riders. What the list cannot consume
            // is dispatched to the pager as nested scroll, from a drag that began at the top only.
            .nestedScroll(handOff)
            .scrollable(scroll, Orientation.Vertical, reverseDirection = true, flingBehavior = fling),
    ) {
        val limit = minOf(maxWidth, maxHeight) / 2 * GROUP_PAGE_SAFE_RADIUS
        val bodyH = if (rows.isEmpty()) GROUP_ROW_H else GROUP_ROW_H * minOf(rows.size, GROUP_PAGE_ROWS)
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
            } else {
                // The five-row window, clipped to its block so a row half-way out never overflows the
                // face. The page's own scrollable drives it; this one only lays out and clips.
                Column(
                    modifier = Modifier.height(bodyH).verticalScroll(scroll, enabled = false),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    rows.forEachIndexed { i, row ->
                        GroupRideRowView(
                            row,
                            unitSystem,
                            // Narrowed to the safe circle's chord at the row's live centre line, read
                            // at layout so a drag re-measures the rows without recomposing them.
                            Modifier.layout { measurable, _ ->
                                val mid = (rowsTop + GROUP_ROW_H * i + GROUP_ROW_H / 2).toPx() - scroll.value
                                val half = sqrt((limit.toPx() * limit.toPx() - mid * mid).coerceAtLeast(0f))
                                val width = (half * 2).roundToInt()
                                    .coerceIn(GROUP_ROW_MIN_W.roundToPx(), GROUP_ROW_W.roundToPx())
                                val placeable = measurable.measure(Constraints.fixed(width, GROUP_ROW_H.roundToPx()))
                                layout(placeable.width, placeable.height) { placeable.place(0, 0) }
                            },
                        )
                    }
                }
            }
        }
        if (maxFirst > 0) {
            // The library centres the arc on 3 o'clock; turn it down about the face centre into the
            // controller temperature's stretch of rim, clear of the duty head tick parked there near 0 %.
            Box(modifier = Modifier.fillMaxSize().graphicsLayer { rotationZ = GROUP_INDICATOR_TURN_DEG }) {
                PositionIndicator(
                    state = indicator,
                    indicatorHeight = GROUP_INDICATOR_LENGTH,
                    indicatorWidth = GROUP_INDICATOR_WIDTH,
                    paddingHorizontal = GAUGE_INNER_INSET,
                    background = GuideColor,
                    color = SecondaryText,
                )
            }
        }
    }
}

/**
 * Settles a drag on a whole row: projects the fling's natural stop, rounds it to the nearest row and
 * springs there from the release velocity. A fling toward an edge the list already sits on is handed
 * back whole, so a flick down from the top reaches the pager.
 */
private class RowSnapFling(
    private val scroll: ScrollState,
    private val stepPx: Float,
    private val decay: DecayAnimationSpec<Float>,
) : FlingBehavior {
    override suspend fun ScrollScope.performFling(initialVelocity: Float): Float {
        if (initialVelocity < 0f && !scroll.canScrollBackward || initialVelocity > 0f && !scroll.canScrollForward) {
            return initialVelocity
        }
        val start = scroll.value.toFloat()
        val projected = decay.calculateTargetValue(start, initialVelocity)
        val target = ((projected / stepPx).roundToInt() * stepPx).coerceIn(0f, scroll.maxValue.toFloat())
        var last = start
        AnimationState(start, initialVelocity).animateTo(
            target,
            spring(stiffness = Spring.StiffnessMediumLow),
            sequentialAnimation = true,
        ) {
            val delta = value - last
            val consumed = scrollBy(delta)
            last = value
            // An edge stopped the list short: nothing left to animate.
            if (abs(delta - consumed) > 0.5f) cancelAnimation()
        }
        return 0f
    }
}

/**
 * Lets only a drag that began with the list at its top reach the pager; any other drag's leftover,
 * and its fling, stop here.
 */
private class TopHandOff(private val scroll: ScrollState) : NestedScrollConnection {
    private var dragging = false
    private var handOff = true

    override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
        if (source == NestedScrollSource.UserInput && !dragging) {
            dragging = true
            handOff = !scroll.canScrollBackward
        }
        return Offset.Zero
    }

    override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset =
        if (handOff) Offset.Zero else available

    override suspend fun onPreFling(available: Velocity): Velocity {
        dragging = false
        return Velocity.Zero
    }

    override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity =
        if (handOff) Velocity.Zero else available
}

/**
 * The list window as a [PositionIndicator] reads it: where the scroll sits in its travel, and how
 * much of the list shows. [total] is the list's length.
 *
 * @parity /watch/watchos/GroupRidePage.swift `GroupWindowIndicator`
 */
private class GroupWindowIndicatorState(
    private val scroll: ScrollState,
    private val total: () -> Int,
) : PositionIndicatorState {
    override val positionFraction: Float
        get() = scroll.value.toFloat() / scroll.maxValue.coerceAtLeast(1)

    override fun sizeFraction(scrollableContainerSizePx: Float): Float =
        GROUP_PAGE_ROWS.toFloat() / total().coerceAtLeast(GROUP_PAGE_ROWS)

    override fun visibility(scrollableContainerSizePx: Float) = PositionIndicatorVisibility.Show
}

@Composable
private fun GroupRideRowView(row: WatchGroupRideRow, unitSystem: String, modifier: Modifier) {
    val stale = row.status == WatchGroupRideStatus.Stale
    Row(
        modifier = modifier
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
            modifier = Modifier.padding(start = 3.dp, end = 2.dp).weight(1f),
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
        Spacer(modifier = Modifier.width(GROUP_VALUE_GAP))
        Box(modifier = Modifier.width(GROUP_STATUS_W), contentAlignment = Alignment.CenterEnd) {
            StatusSlot(row.status)
        }
    }
}

/** @parity /watch/watchos/GroupRidePage.swift `statusSlot` */
@Composable
private fun StatusSlot(status: WatchGroupRideStatus) {
    val style = WatchTypography.mono(MaterialTheme.typography.caption2.copy(fontSize = GROUP_VALUE_FONT))
    when (status) {
        WatchGroupRideStatus.Stale -> Text(text = "lost", style = style, color = DimText)
        WatchGroupRideStatus.NoBoard -> Text(text = DASH, style = style, color = DimText)
        is WatchGroupRideStatus.Hot -> {
            val color = telemetryLevelColor(status.level) ?: SecondaryText
            Canvas(modifier = Modifier.size(GROUP_THERMOMETER_W, GROUP_THERMOMETER_H)) {
                drawThermometer(color, Offset.Zero, Size(size.width, size.height))
            }
        }
        is WatchGroupRideStatus.Battery -> Text(
            text = "${status.percent}%",
            style = style,
            color = telemetryLevelColor(status.level) ?: SecondaryText,
        )
    }
}

/**
 * Filled arrow pointing up (straight ahead) before rotation, centred in the canvas.
 *
 * @parity /watch/watchos/GroupRidePage.swift `BearingArrow`
 */
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
 * Rows on screen before the list scrolls.
 *
 * @parity /watch/watchos/GroupRidePage.swift `GROUP_PAGE_ROWS`
 */
private const val GROUP_PAGE_ROWS = 5

/**
 * The position arc: 40 dp along the rim, 3 dp thick, its outer edge on [GAUGE_INNER_INSET] — inside
 * the rim arcs, and well clear of the rows, which the safe circle holds to about 75 dp from the
 * centre. Turned [GROUP_INDICATOR_TURN_DEG] below 3 o'clock, it spans about 6–30°: inside the
 * controller temperature arc (4–36°), which draws no head tick, and below the duty head tick, which
 * reaches in past the arc while duty is near 0 %.
 *
 * @parity /watch/watchos/GroupRidePage.swift `GROUP_INDICATOR_LENGTH`
 */
private val GROUP_INDICATOR_LENGTH = 40.dp
private val GROUP_INDICATOR_WIDTH = 3.dp
private const val GROUP_INDICATOR_TURN_DEG = 18f

/**
 * How long one crown step slides the rows.
 *
 * @parity /watch/watchos/GroupRidePage.swift `GROUP_STEP_SECONDS`
 */
private const val GROUP_STEP_MS = 150

/** Each row's width is clamped to the chord of this share of the face radius at its centre line. */
private const val GROUP_PAGE_SAFE_RADIUS = 0.8f
private val GROUP_ROW_H = 22.dp
/**
 * A row is 150 dp, narrowed to the safe chord but never below [GROUP_ROW_MIN_W]: 93 dp of fixed
 * columns plus 45 dp, a five-character name ("Tomek" is 42.5 dp) unclipped. On a small face the
 * widened outer rows reach just past the safe circle, still inside the face.
 *
 * @parity /watch/watchos/GroupRidePage.swift `GROUP_ROW_WIDTH`
 */
private val GROUP_ROW_W = 150.dp
private val GROUP_ROW_MIN_W = 138.dp
private val GROUP_TITLE_H = 14.dp
private val GROUP_TITLE_GAP = 4.dp
private val GROUP_TITLE_FONT = 11.sp
private val GROUP_NAME_FONT = 13.sp
private val GROUP_VALUE_FONT = 11.sp
private val GROUP_ROW_DOT = 6.dp
private val GROUP_ARROW_BOX = 10.dp
/** Six mono characters ("12.3km") at the value size; "100%" or "lost" in the status slot. */
private val GROUP_DISTANCE_W = 40.dp
private val GROUP_STATUS_W = 27.dp
/** Between the distance and the status slot, so "49m" and "lost" never run together. */
private val GROUP_VALUE_GAP = 5.dp
private val GROUP_THERMOMETER_W = 7.dp
private val GROUP_THERMOMETER_H = 15.dp
/** A lost Rider's row: there, but plainly not current. */
private const val GROUP_STALE_ROW_ALPHA = 0.4f
