package app.vescape.wear

import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerDefaults
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.wear.compose.foundation.BasicSwipeToDismissBox
import androidx.wear.compose.foundation.edgeSwipeToDismiss
import androidx.wear.compose.foundation.rememberSwipeToDismissBoxState
import androidx.wear.compose.material.MaterialTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Screen shell around the live Watch Frame. The rim gauges ([FrameLayout]) are pinned at the root
 * and drawn once; both pagers are transparent and only swap what sits in the centre of the circle,
 * so the rider never loses speed, duty, battery and temps by swiping. Routes between the Board
 * Move page ([MoveScreen]), the diagnostics pager page ([DiagnosticsScreen]), the
 * waiting/disconnected status layouts and the close prompt. Also owns the refresh tick that ages a
 * stopped stream into DISCONNECTED. The board Lights page ([LightsScreen]) sits between them.
 *
 * The mirror deliberately does not hold the screen on. `FLAG_KEEP_SCREEN_ON` also suppresses
 * ambient, so a ride ran the display at full brightness for hours and the low-power always-on
 * rendering below was unreachable — by far the largest battery cost the wrist had.
 *
 * Ambient does not replace this tree, it settles it: the pagers stay mounted and are parked on the
 * gauges with their gestures off, so going in and out of always-on never rebuilds the screen or
 * restarts the idle clock. What ambient changes is inside [AmbientMode].
 */
@Composable
internal fun MirrorScreen(
    sender: CommandSender,
    ambient: AmbientMode = AmbientOff,
    onRequestClose: () -> Unit = {},
) {
    val isAmbient = ambient.active
    val state by TelemetryState.mirrorState
    val phoneLink by TelemetryState.phoneLink
    var showClosePrompt by remember { mutableStateOf(false) }
    // A hold must not be interpreted as a page swipe, and must never end because the page moved.
    var moveHeld by remember { mutableStateOf(false) }
    // One pager owns the whole vertical axis: weather above the gauges, nav focus below. Two
    // stacked vertical pagers used to compete for the same drag — the inner one claimed the
    // pointer, forwarded the leftover delta to the outer one but kept the velocity, so the outer
    // could only settle by dragging past half the screen and a normal flick sprang back.
    val verticalPagerState = rememberPagerState(initialPage = VERTICAL_PAGE_GAUGES, pageCount = { VERTICAL_PAGE_COUNT })
    // Fractional position on the axis, from radar at 0 up to nav focus at the end. Both focus
    // progresses are read off it, so a drag fades exactly as far as it has travelled.
    val verticalPosition = {
        verticalPagerState.currentPage + verticalPagerState.currentPageOffsetFraction
    }
    // Nav focus is a page of its own so the drag is a real gesture, but nothing new is drawn there:
    // the gauges pin themselves in place (see [navFocus]) and shed their readouts on the way.
    val navFocus = { (verticalPosition() - VERTICAL_PAGE_GAUGES).coerceIn(0f, 1f) }
    val scope = rememberCoroutineScope()
    // Which page owns the vertical axis right now. The radar page fetches while it is on screen and
    // nowhere else, so this is the difference between an idle wrist and a fetching one.
    val onGauges = verticalPagerState.currentPage == VERTICAL_PAGE_GAUGES
    val radarVisible = !isAmbient && verticalPagerState.currentPage == VERTICAL_PAGE_RADAR

    // Mutually exclusive by `enabled`: back closes the innermost thing that is open, and only the
    // gauges themselves treat back as "leave the mirror".
    BackHandler(enabled = showClosePrompt) {
        showClosePrompt = false
    }
    // Anywhere else on the vertical axis returns to the gauges; only the gauges treat back as leave.
    BackHandler(enabled = !showClosePrompt && !onGauges) {
        scope.launch { verticalPagerState.animateScrollToPage(VERTICAL_PAGE_GAUGES) }
    }
    BackHandler(enabled = !showClosePrompt && onGauges) {
        showClosePrompt = true
    }

    LaunchedEffect(isAmbient) {
        while (true) {
            delay(if (isAmbient) AMBIENT_REFRESH_INTERVAL_MS else WATCH_FRAME_INTERVAL_MS)
            TelemetryState.refresh()
        }
    }

    MaterialTheme {
        when {
            showClosePrompt -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                ClosePrompt(onStay = { showClosePrompt = false }, onClose = onRequestClose)
            }
            else -> {
                val dismissState = rememberSwipeToDismissBoxState()
                // Page 0 = gauges centre (empty), 1 = Board Move, 2 = board Lights,
                // 3 = diagnostics. Dismiss stays on the left edge; interior horizontal swipes page.
                val controlPagerState = rememberPagerState(pageCount = { CONTROL_PAGE_COUNT })
                var dismissEnabled by remember { mutableStateOf(true) }
                // Idle clock for the auto-return.
                var lastTouchMs by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
                // Both pagers are transparent: they only swap the centre of the circle. Their drag
                // offsets are the focus progresses the pinned frame fades its readouts against.
                val controlFocus = {
                    (controlPagerState.currentPage + controlPagerState.currentPageOffsetFraction)
                        .coerceIn(0f, 1f)
                }
                val weatherFocus = { (VERTICAL_PAGE_GAUGES - verticalPosition()).coerceIn(0f, 1f) }
                // The wrist goes always-on wherever the rider left it. Ambient only ever draws the
                // gauges, so park both axes there first — without this the arcs would be pinned
                // over a control page the rider can no longer swipe away.
                LaunchedEffect(isAmbient) {
                    if (!isAmbient) return@LaunchedEffect
                    verticalPagerState.scrollToPage(VERTICAL_PAGE_GAUGES)
                    controlPagerState.scrollToPage(CONTROL_PAGE_GAUGES)
                }
                // A page is interactive only once it has settled: a tap landing mid-swipe belongs
                // to the gesture, not to the control it happened to be over. Derived, so the drag
                // offset does not invalidate the whole mirror on every frame of a swipe.
                val activePage by remember(controlPagerState) {
                    derivedStateOf {
                        controlPagerState.currentPage.takeIf {
                            !controlPagerState.isScrollInProgress &&
                                controlPagerState.currentPageOffsetFraction == 0f
                        }
                    }
                }
                // The readout only answers a tap while the gauges own both axes; mid-swipe or on
                // another page the tap belongs to the page under it.
                val weatherTappable by remember(controlPagerState, verticalPagerState, isAmbient) {
                    derivedStateOf {
                        !isAmbient &&
                            activePage == CONTROL_PAGE_GAUGES &&
                            !verticalPagerState.isScrollInProgress &&
                            verticalPagerState.currentPage == VERTICAL_PAGE_GAUGES
                    }
                }
                // PagerState.settledPage can change before the snap reaches offset zero.
                // Changing the parent modifier then cancels that animation mid-page.
                LaunchedEffect(
                    controlPagerState.isScrollInProgress,
                    verticalPagerState.isScrollInProgress,
                ) {
                    if (!controlPagerState.isScrollInProgress &&
                        controlPagerState.currentPageOffsetFraction == 0f &&
                        !verticalPagerState.isScrollInProgress &&
                        verticalPagerState.currentPageOffsetFraction == 0f
                    ) {
                        dismissEnabled = controlPagerState.currentPage == CONTROL_PAGE_GAUGES &&
                            verticalPagerState.currentPage == VERTICAL_PAGE_GAUGES
                    }
                }
                // Horizontal pages are transient controls, so an untouched wrist drifts back to
                // the gauges. The vertical axis is never moved: weather and the nav-focus map are
                // places a rider parks on deliberately. Re-keying on lastTouchMs restarts the
                // window; a held Move suspends it outright.
                LaunchedEffect(lastTouchMs, moveHeld, isAmbient) {
                    // Ambient has already parked the pager, and an animation there is wasted panel.
                    if (moveHeld || isAmbient) return@LaunchedEffect
                    delay(CONTROL_IDLE_RETURN_MS)
                    if (controlPagerState.currentPage != CONTROL_PAGE_GAUGES) {
                        controlPagerState.animateScrollToPage(CONTROL_PAGE_GAUGES)
                    }
                }
                // The dismiss box wraps the pinned gauges. Outside it, a dismiss drag would slide
                // the transparent pages away while the arcs stayed nailed down.
                BasicSwipeToDismissBox(
                    onDismissed = { showClosePrompt = true },
                    state = dismissState,
                    userSwipeEnabled = dismissEnabled && !isAmbient,
                ) { isBackground ->
                    Box(
                        // Initial pass: the event is seen before any child consumes it, so a tap
                        // that lands on a Move half or does nothing at all still counts as touch.
                        modifier = Modifier
                            .fillMaxSize()
                            .pointerInput(Unit) {
                                awaitPointerEventScope {
                                    while (true) {
                                        awaitPointerEvent(PointerEventPass.Initial)
                                        lastTouchMs = SystemClock.elapsedRealtime()
                                    }
                                }
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (isBackground) {
                            ClosePrompt(onStay = { showClosePrompt = false }, onClose = onRequestClose)
                        } else {
                            VerticalPager(
                                state = verticalPagerState,
                                // The vertical axis belongs to the gauges alone: weather above,
                                // nav focus below. From a control page it would open a blank map
                                // over a page the rider is working on, so it is only live there.
                                userScrollEnabled = !isAmbient && !moveHeld && activePage == CONTROL_PAGE_GAUGES,
                                // A page swap on the wrist is a flick, not a drag: the default
                                // half-screen threshold means a rider has to pull the weather page
                                // most of the way down or watch it spring back.
                                flingBehavior = PagerDefaults.flingBehavior(
                                    state = verticalPagerState,
                                    snapPositionalThreshold = PAGE_SNAP_THRESHOLD,
                                ),
                                modifier = Modifier.fillMaxSize(),
                            ) { verticalPage ->
                                when (verticalPage) {
                                    VERTICAL_PAGE_RADAR -> RadarScreen(visible = radarVisible)
                                    VERTICAL_PAGE_WEATHER -> WeatherScreen()
                                    // Gesture-only page: nothing is drawn here, the drag offset
                                    // alone is the nav-focus progress. Keeping the gauges out of
                                    // the pager is what makes this a transition rather than a page
                                    // swap — a pager clips its pages, so content inside would
                                    // slide away instead of pinning.
                                    VERTICAL_PAGE_NAV -> Unit
                                    else -> HorizontalPager(
                                        state = controlPagerState,
                                        userScrollEnabled = !isAmbient && !moveHeld,
                                        modifier = Modifier
                                            .fillMaxSize()
                                            .then(
                                                if (dismissEnabled) {
                                                    Modifier.edgeSwipeToDismiss(dismissState)
                                                } else {
                                                    Modifier
                                                },
                                            ),
                                    ) { page ->
                                        Box(
                                            modifier = Modifier.fillMaxSize(),
                                            contentAlignment = Alignment.Center,
                                        ) {
                                            when (page) {
                                                // Page 0 is empty: it is the gauges themselves,
                                                // pinned at the root behind this transparent pager.
                                                CONTROL_PAGE_GAUGES -> Unit
                                                CONTROL_PAGE_MOVE -> MoveScreen(
                                                    sender = sender,
                                                    // Ambient parks the pager, but the park is a
                                                    // scroll and this gate is not: a held Move must
                                                    // stop the moment the wrist goes always-on, not
                                                    // once the page has finished travelling.
                                                    interactionEnabled = !isAmbient && activePage == CONTROL_PAGE_MOVE,
                                                    onHoldChanged = { moveHeld = it },
                                                )
                                                CONTROL_PAGE_LIGHTS -> LightsScreen(
                                                    sender = sender,
                                                    interactionEnabled = !isAmbient && activePage == CONTROL_PAGE_LIGHTS,
                                                )
                                                CONTROL_PAGE_DIAGNOSTICS -> DiagnosticsScreen()
                                                else -> Unit
                                            }
                                        }
                                    }
                                }
                            }
                            // Rim arcs, drawn once at the root and never inside a pager: the rider
                            // keeps speed, duty, battery and temps on every page. Drawn *over* the
                            // pagers, because the forecast readout is the one thing here a rider
                            // taps and a full-screen pager above it would eat the tap. Nothing else
                            // in the frame takes pointer input, so the pages stay reachable.
                            MirrorContent(
                                state = state,
                                phoneLink = phoneLink,
                                ambient = ambient,
                                focus = navFocus,
                                controlFocus = controlFocus,
                                weatherFocus = weatherFocus,
                                onWeatherClick = if (weatherTappable) {
                                    {
                                        scope.launch {
                                            verticalPagerState.animateScrollToPage(VERTICAL_PAGE_WEATHER)
                                        }
                                    }
                                } else {
                                    null
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Fraction of a page a drag must cover to settle on the next one rather than spring back. */
private const val PAGE_SNAP_THRESHOLD = 0.25f

/** Idle time after which the horizontal pager drifts back to the gauges. */
private const val CONTROL_IDLE_RETURN_MS = 45_000L

/**
 * Radar and weather above the gauges, nav focus below: one pager owns the whole vertical axis.
 * Radar sits above the forecast because it is the same subject one step further out — the rider
 * swipes up from the numbers, to the hours, to the sky itself.
 */
private const val VERTICAL_PAGE_RADAR = 0
private const val VERTICAL_PAGE_WEATHER = 1
private const val VERTICAL_PAGE_GAUGES = 2
private const val VERTICAL_PAGE_NAV = 3
private const val VERTICAL_PAGE_COUNT = 4

/** Gauges centre, Board Move, board Lights, diagnostics. */
private const val CONTROL_PAGE_GAUGES = 0
private const val CONTROL_PAGE_MOVE = 1
private const val CONTROL_PAGE_LIGHTS = 2
private const val CONTROL_PAGE_DIAGNOSTICS = 3
private const val CONTROL_PAGE_COUNT = 4

@Composable
private fun MirrorContent(
    state: MirrorState,
    phoneLink: PhoneLink,
    ambient: AmbientMode,
    focus: () -> Float = { 0f },
    controlFocus: () -> Float = { 0f },
    weatherFocus: () -> Float = { 0f },
    onWeatherClick: (() -> Unit)? = null,
) {
    when (state.status) {
        MirrorStatus.DISCONNECTED -> {
            if (phoneLink == PhoneLink.NO_PHONE) {
                // No arcs to pin without a phone, only the notice — and it is a readout, so it
                // leaves with them rather than bleeding under whatever page took the centre.
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer { alpha = fadeOut(maxOf(focus(), controlFocus(), weatherFocus())) },
                    contentAlignment = Alignment.Center,
                ) {
                    DisconnectedLayout(ambient)
                }
            } else {
                FrameLayout(EMPTY_FRAME, false, focus, controlFocus, weatherFocus, onWeatherClick, ambient)
            }
        }
        MirrorStatus.WAITING ->
            FrameLayout(state.frame!!, false, focus, controlFocus, weatherFocus, onWeatherClick, ambient)
        MirrorStatus.STALE ->
            FrameLayout(state.frame!!, true, focus, controlFocus, weatherFocus, onWeatherClick, ambient)
        MirrorStatus.LIVE ->
            FrameLayout(state.frame!!, false, focus, controlFocus, weatherFocus, onWeatherClick, ambient)
    }
}

/** Stable gauge shell shown before the first phone frame; every board lane renders as disabled. */
private val EMPTY_FRAME = WatchFrame(
    speed = null,
    duty = null,
    battery = null,
    motorTemp = null,
    ctrlTemp = null,
    stale = false,
)

/**
 * Ambient repaint cadence. The phone drops to a 5 s push while the wrist is in ambient
 * (`WATCH_FRAME_AMBIENT_INTERVAL_MS`), so a slower tick here only ages the reading on screen without
 * saving a single radio wake. One minute — the system's own ambient callback rate — left battery and
 * temperatures up to a minute behind data the watch already had in memory.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `WATCH_FRAME_AMBIENT_INTERVAL_MS`
 */
private const val AMBIENT_REFRESH_INTERVAL_MS = 10_000L
