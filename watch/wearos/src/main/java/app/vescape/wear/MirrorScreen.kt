package app.vescape.wear

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
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
 * waiting/disconnected status layouts, the ambient hero, and the close prompt. Also owns the
 * refresh tick that ages a stopped stream into DISCONNECTED.
 *
 * The mirror deliberately does not hold the screen on. `FLAG_KEEP_SCREEN_ON` also suppresses
 * ambient, so a ride ran the display at full brightness for hours and the low-power ambient hero
 * below was unreachable — by far the largest battery cost the wrist had.
 */
@Composable
fun MirrorScreen(
    sender: CommandSender,
    isAmbient: Boolean = false,
    onRequestClose: () -> Unit = {},
) {
    val state by TelemetryState.mirrorState
    val phoneLink by TelemetryState.phoneLink
    var showClosePrompt by remember { mutableStateOf(false) }
    // A hold must not be interpreted as a page swipe, and must never end because the page moved.
    var moveHeld by remember { mutableStateOf(false) }
    val weatherPagerState = rememberPagerState(initialPage = 1, pageCount = { 2 })
    // Nav focus is a page of its own so the drag is a real gesture, but nothing new is drawn there:
    // the gauges pin themselves in place (see [navFocus]) and shed their readouts on the way.
    val navPagerState = rememberPagerState(pageCount = { 2 })
    val navFocus = { (navPagerState.currentPage + navPagerState.currentPageOffsetFraction).coerceIn(0f, 1f) }
    val navFocused = navPagerState.currentPage != 0
    val scope = rememberCoroutineScope()
    val weatherVisible = !isAmbient && weatherPagerState.currentPage == 0

    // Mutually exclusive by `enabled`: back closes the innermost thing that is open, and only the
    // gauges themselves treat back as "leave the mirror".
    BackHandler(enabled = showClosePrompt) {
        showClosePrompt = false
    }
    BackHandler(enabled = !showClosePrompt && weatherVisible) {
        scope.launch { weatherPagerState.animateScrollToPage(1) }
    }
    BackHandler(enabled = !showClosePrompt && !weatherVisible && navFocused) {
        scope.launch { navPagerState.animateScrollToPage(0) }
    }
    BackHandler(enabled = !showClosePrompt && !weatherVisible && !navFocused) {
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
            // Ambient bypasses the pager: always the dim hero, never the diagnostics page.
            isAmbient -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                MirrorContent(state = state, phoneLink = phoneLink, isAmbient = true)
            }
            else -> {
                val dismissState = rememberSwipeToDismissBoxState()
                // Page 0 = gauges centre (empty), 1 = Board Move, 2 = reserved for Lights (#456),
                // 3 = diagnostics. Dismiss stays on the left edge; interior horizontal swipes page.
                val controlPagerState = rememberPagerState(pageCount = { CONTROL_PAGE_COUNT })
                var dismissEnabled by remember { mutableStateOf(true) }
                // Both pagers are transparent: they only swap the centre of the circle. Their drag
                // offsets are the focus progresses the pinned frame fades its readouts against.
                val controlFocus = {
                    (controlPagerState.currentPage + controlPagerState.currentPageOffsetFraction)
                        .coerceIn(0f, 1f)
                }
                val weatherFocus = {
                    (1f - (weatherPagerState.currentPage + weatherPagerState.currentPageOffsetFraction))
                        .coerceIn(0f, 1f)
                }
                val moveInteractionEnabled =
                    controlPagerState.currentPage == 1 &&
                        !controlPagerState.isScrollInProgress &&
                        controlPagerState.currentPageOffsetFraction == 0f
                // PagerState.settledPage can change before the snap reaches offset zero.
                // Changing the parent modifier then cancels that animation mid-page.
                LaunchedEffect(
                    controlPagerState.isScrollInProgress,
                    weatherPagerState.isScrollInProgress,
                    navFocused,
                ) {
                    if (!controlPagerState.isScrollInProgress &&
                        controlPagerState.currentPageOffsetFraction == 0f &&
                        !weatherPagerState.isScrollInProgress &&
                        weatherPagerState.currentPageOffsetFraction == 0f
                    ) {
                        dismissEnabled = controlPagerState.currentPage == 0 &&
                            weatherPagerState.currentPage == 1 &&
                            !navFocused
                    }
                }
                // The dismiss box wraps the pinned gauges. Outside it, a dismiss drag would slide
                // the transparent pages away while the arcs stayed nailed down.
                BasicSwipeToDismissBox(
                    onDismissed = { showClosePrompt = true },
                    state = dismissState,
                    userSwipeEnabled = dismissEnabled,
                ) { isBackground ->
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        if (isBackground) {
                            ClosePrompt(onStay = { showClosePrompt = false }, onClose = onRequestClose)
                        } else {
                            // Rim arcs, drawn once at the root and never inside a pager: the rider
                            // keeps speed, duty, battery and temps on every page.
                            MirrorContent(
                                state = state,
                                phoneLink = phoneLink,
                                isAmbient = false,
                                focus = navFocus,
                                controlFocus = controlFocus,
                                weatherFocus = weatherFocus,
                                onWeatherClick = {
                                    scope.launch { weatherPagerState.animateScrollToPage(0) }
                                },
                            )
                            VerticalPager(
                                state = weatherPagerState,
                                userScrollEnabled = !moveHeld,
                                modifier = Modifier.fillMaxSize(),
                            ) { weatherPage ->
                                if (weatherPage == 0) {
                                    WeatherScreen()
                                } else {
                                    HorizontalPager(
                                        state = controlPagerState,
                                        userScrollEnabled = !moveHeld && !navFocused,
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
                                                // Gesture-only pager over the gauges: both its
                                                // pages are empty, and its drag offset is the
                                                // nav-focus progress. Keeping the gauges out of
                                                // it is what makes this a transition rather
                                                // than a page swap — a pager clips its pages,
                                                // so content inside would slide away instead.
                                                0 -> VerticalPager(
                                                    state = navPagerState,
                                                    modifier = Modifier.fillMaxSize(),
                                                ) {}
                                                1 -> MoveScreen(
                                                    sender = sender,
                                                    interactionEnabled = moveInteractionEnabled,
                                                    onHoldChanged = { moveHeld = it },
                                                )
                                                // Page 2 is deliberately empty: the Lights page
                                                // lands here without touching pager wiring.
                                                3 -> DiagnosticsScreen()
                                                else -> Unit
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Gauges centre, Board Move, the reserved Lights slot, diagnostics. */
private const val CONTROL_PAGE_COUNT = 4

@Composable
private fun MirrorContent(
    state: MirrorState,
    phoneLink: PhoneLink,
    isAmbient: Boolean,
    focus: () -> Float = { 0f },
    controlFocus: () -> Float = { 0f },
    weatherFocus: () -> Float = { 0f },
    onWeatherClick: () -> Unit = {},
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
                    DisconnectedLayout(isAmbient)
                }
            } else if (isAmbient) {
                AmbientLayout(EMPTY_FRAME)
            } else {
                FrameLayout(EMPTY_FRAME, muted = false, focus, controlFocus, weatherFocus, onWeatherClick)
            }
        }
        MirrorStatus.WAITING -> if (isAmbient) {
            AmbientLayout(state.frame!!)
        } else {
            FrameLayout(state.frame!!, muted = false, focus, controlFocus, weatherFocus, onWeatherClick)
        }
        MirrorStatus.STALE -> if (isAmbient) {
            AmbientLayout(state.frame!!)
        } else {
            FrameLayout(state.frame!!, muted = true, focus, controlFocus, weatherFocus, onWeatherClick)
        }
        MirrorStatus.LIVE -> if (isAmbient) {
            AmbientLayout(state.frame!!)
        } else {
            FrameLayout(state.frame!!, muted = false, focus, controlFocus, weatherFocus, onWeatherClick)
        }
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

private const val AMBIENT_REFRESH_INTERVAL_MS = 60_000L
