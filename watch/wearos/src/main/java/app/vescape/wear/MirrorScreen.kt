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
import androidx.wear.compose.foundation.BasicSwipeToDismissBox
import androidx.wear.compose.foundation.edgeSwipeToDismiss
import androidx.wear.compose.foundation.rememberSwipeToDismissBoxState
import androidx.wear.compose.material.MaterialTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Screen shell around the live Watch Frame: routes between the gauges ([FrameLayout]), the Board
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
                VerticalPager(
                    state = weatherPagerState,
                    userScrollEnabled = !moveHeld,
                    modifier = Modifier.fillMaxSize(),
                ) { weatherPage ->
                    if (weatherPage == 0) {
                        WeatherScreen()
                    } else {
                        // Page 0 = gauges, page 1 = Board Move, page 2 = diagnostics. Dismiss
                        // stays on the left edge; interior horizontal swipes page between them.
                        val dismissState = rememberSwipeToDismissBoxState()
                        val pagerState = rememberPagerState(pageCount = { 3 })
                        var dismissEnabled by remember { mutableStateOf(true) }
                        val moveInteractionEnabled =
                            pagerState.currentPage == 1 &&
                                !pagerState.isScrollInProgress &&
                                pagerState.currentPageOffsetFraction == 0f
                        // PagerState.settledPage can change before the snap reaches offset zero.
                        // Changing the parent modifier then cancels that animation mid-page.
                        LaunchedEffect(pagerState.isScrollInProgress, navFocused) {
                            if (!pagerState.isScrollInProgress && pagerState.currentPageOffsetFraction == 0f) {
                                dismissEnabled = pagerState.currentPage == 0 && !navFocused
                            }
                        }
                        BasicSwipeToDismissBox(
                            onDismissed = { showClosePrompt = true },
                            state = dismissState,
                            userSwipeEnabled = dismissEnabled,
                        ) { isBackground ->
                            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                if (isBackground) {
                                    ClosePrompt(onStay = { showClosePrompt = false }, onClose = onRequestClose)
                                } else {
                                    HorizontalPager(
                                        state = pagerState,
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
                                                0 -> Box(modifier = Modifier.fillMaxSize()) {
                                                    MirrorContent(
                                                        state = state,
                                                        phoneLink = phoneLink,
                                                        isAmbient = false,
                                                        focus = navFocus,
                                                        onWeatherClick = {
                                                            scope.launch {
                                                                weatherPagerState.animateScrollToPage(0)
                                                            }
                                                        },
                                                    )
                                                    // Gesture-only pager over the gauges: both its
                                                    // pages are empty, and its drag offset is the
                                                    // nav-focus progress. Keeping the gauges out of
                                                    // it is what makes this a transition rather
                                                    // than a page swap — a pager clips its pages,
                                                    // so content inside would slide away instead.
                                                    VerticalPager(
                                                        state = navPagerState,
                                                        modifier = Modifier.fillMaxSize(),
                                                    ) {}
                                                }
                                                1 -> MoveScreen(
                                                    sender = sender,
                                                    interactionEnabled = moveInteractionEnabled,
                                                    onHoldChanged = { moveHeld = it },
                                                )
                                                else -> DiagnosticsScreen()
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

@Composable
private fun MirrorContent(
    state: MirrorState,
    phoneLink: PhoneLink,
    isAmbient: Boolean,
    focus: () -> Float = { 0f },
    onWeatherClick: () -> Unit = {},
) {
    when (state.status) {
        MirrorStatus.DISCONNECTED -> {
            if (phoneLink == PhoneLink.NO_PHONE) {
                DisconnectedLayout(isAmbient)
            } else if (isAmbient) {
                AmbientLayout(EMPTY_FRAME)
            } else {
                FrameLayout(EMPTY_FRAME, muted = false, focus = focus, onWeatherClick = onWeatherClick)
            }
        }
        MirrorStatus.WAITING -> if (isAmbient) {
            AmbientLayout(state.frame!!)
        } else {
            FrameLayout(state.frame!!, muted = false, focus = focus, onWeatherClick = onWeatherClick)
        }
        MirrorStatus.STALE -> if (isAmbient) {
            AmbientLayout(state.frame!!)
        } else {
            FrameLayout(state.frame!!, muted = true, focus = focus, onWeatherClick = onWeatherClick)
        }
        MirrorStatus.LIVE -> if (isAmbient) {
            AmbientLayout(state.frame!!)
        } else {
            FrameLayout(state.frame!!, muted = false, focus = focus, onWeatherClick = onWeatherClick)
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
