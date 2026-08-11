package app.vescape.wear

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.wear.compose.foundation.BasicSwipeToDismissBox
import androidx.wear.compose.foundation.edgeSwipeToDismiss
import androidx.wear.compose.foundation.rememberSwipeToDismissBoxState
import androidx.wear.compose.material.MaterialTheme
import kotlinx.coroutines.delay

/**
 * Screen shell around the live Watch Frame: routes between the gauges ([FrameLayout]), the Board
 * Move page ([MoveScreen]), the diagnostics pager page ([DiagnosticsScreen]), the
 * waiting/disconnected status layouts, the ambient hero, and the close prompt. Also owns the refresh tick that ages a stopped stream into
 * DISCONNECTED and the keep-screen-awake flag while telemetry is LIVE.
 */
@Composable
fun MirrorScreen(
    sender: CommandSender,
    isAmbient: Boolean = false,
    onKeepScreenAwakeChanged: (Boolean) -> Unit = {},
    onRequestClose: () -> Unit = {},
) {
    val state by TelemetryState.mirrorState
    val phoneLink by TelemetryState.phoneLink
    val keepScreenAwake = state.status == MirrorStatus.LIVE && !isAmbient
    var showClosePrompt by remember { mutableStateOf(false) }
    var showWeather by remember { mutableStateOf(false) }
    // A hold must not be interpreted as a page swipe, and must never end because the page moved.
    var moveHeld by remember { mutableStateOf(false) }

    // Mutually exclusive by `enabled`: back closes the innermost thing that is open, and only the
    // gauges themselves treat back as "leave the mirror".
    BackHandler(enabled = showClosePrompt) {
        showClosePrompt = false
    }
    BackHandler(enabled = !showClosePrompt && showWeather) {
        showWeather = false
    }
    BackHandler(enabled = !showClosePrompt && !showWeather) {
        showClosePrompt = true
    }

    DisposableEffect(keepScreenAwake) {
        onKeepScreenAwakeChanged(keepScreenAwake)
        onDispose { onKeepScreenAwakeChanged(false) }
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
            showWeather -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                WeatherScreen()
            }
            else -> {
                // Page 0 = gauges, page 1 = Board Move, page 2 = diagnostics. Dismiss (close
                // prompt) stays on the left edge via edgeSwipeToDismiss; interior swipes page.
                val dismissState = rememberSwipeToDismissBoxState()
                val pagerState = rememberPagerState(pageCount = { 3 })
                var dismissEnabled by remember { mutableStateOf(true) }
                val moveInteractionEnabled =
                    pagerState.currentPage == 1 &&
                        !pagerState.isScrollInProgress &&
                        pagerState.currentPageOffsetFraction == 0f
                // PagerState.settledPage can change before the snap animation reaches offset zero.
                // Changing the parent's swipe modifier then cancels that animation mid-page, so
                // latch dismiss ownership only after the pager is physically at rest.
                LaunchedEffect(pagerState.isScrollInProgress) {
                    if (!pagerState.isScrollInProgress && pagerState.currentPageOffsetFraction == 0f) {
                        dismissEnabled = pagerState.currentPage == 0
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
                                userScrollEnabled = !moveHeld,
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
                                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    when (page) {
                                        0 -> MirrorContent(
                                            state = state,
                                            phoneLink = phoneLink,
                                            isAmbient = false,
                                            onWeatherClick = { showWeather = true },
                                        )
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

@Composable
private fun MirrorContent(
    state: MirrorState,
    phoneLink: PhoneLink,
    isAmbient: Boolean,
    onWeatherClick: () -> Unit = {},
) {
    when (state.status) {
        MirrorStatus.DISCONNECTED -> {
            if (phoneLink == PhoneLink.NO_PHONE) {
                DisconnectedLayout(isAmbient)
            } else if (isAmbient) {
                AmbientLayout(EMPTY_FRAME)
            } else {
                FrameLayout(EMPTY_FRAME, muted = false, onWeatherClick = onWeatherClick)
            }
        }
        MirrorStatus.WAITING -> if (isAmbient) {
            AmbientLayout(state.frame!!)
        } else {
            FrameLayout(state.frame!!, muted = false, onWeatherClick = onWeatherClick)
        }
        MirrorStatus.STALE -> if (isAmbient) {
            AmbientLayout(state.frame!!)
        } else {
            FrameLayout(state.frame!!, muted = true, onWeatherClick = onWeatherClick)
        }
        MirrorStatus.LIVE -> if (isAmbient) {
            AmbientLayout(state.frame!!)
        } else {
            FrameLayout(state.frame!!, muted = false, onWeatherClick = onWeatherClick)
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
