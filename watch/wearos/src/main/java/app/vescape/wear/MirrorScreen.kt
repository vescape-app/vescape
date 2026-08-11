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
 * Screen shell around the live Watch Frame: routes between the gauges ([FrameLayout]), the
 * diagnostics pager page ([DiagnosticsScreen]), the waiting/disconnected status layouts, the
 * ambient hero, and the close prompt. Also owns the refresh tick that ages a stopped stream into
 * DISCONNECTED and the keep-screen-awake flag while telemetry is LIVE.
 */
@Composable
fun MirrorScreen(
    isAmbient: Boolean = false,
    onKeepScreenAwakeChanged: (Boolean) -> Unit = {},
    onRequestClose: () -> Unit = {},
) {
    val state by TelemetryState.mirrorState
    val phoneLink by TelemetryState.phoneLink
    val keepScreenAwake = state.status == MirrorStatus.LIVE && !isAmbient
    var showClosePrompt by remember { mutableStateOf(false) }

    BackHandler(enabled = showClosePrompt) {
        showClosePrompt = false
    }
    BackHandler(enabled = !showClosePrompt) {
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
            else -> {
                // Page 0 = gauges, page 1 = diagnostics. Dismiss (close prompt) stays on the left
                // edge via edgeSwipeToDismiss; interior swipes page between the two.
                val dismissState = rememberSwipeToDismissBoxState()
                val pagerState = rememberPagerState(pageCount = { 2 })
                BasicSwipeToDismissBox(
                    onDismissed = { showClosePrompt = true },
                    state = dismissState,
                ) { isBackground ->
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        if (isBackground) {
                            ClosePrompt(onStay = { showClosePrompt = false }, onClose = onRequestClose)
                        } else {
                            HorizontalPager(
                                state = pagerState,
                                modifier = Modifier.fillMaxSize().edgeSwipeToDismiss(dismissState),
                            ) { page ->
                                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    when (page) {
                                        0 -> MirrorContent(state = state, phoneLink = phoneLink, isAmbient = false)
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
private fun MirrorContent(state: MirrorState, phoneLink: PhoneLink, isAmbient: Boolean) {
    when (state.status) {
        MirrorStatus.DISCONNECTED -> {
            if (phoneLink == PhoneLink.NO_PHONE) {
                DisconnectedLayout(isAmbient)
            } else if (isAmbient) {
                AmbientLayout(EMPTY_FRAME)
            } else {
                FrameLayout(EMPTY_FRAME, muted = false)
            }
        }
        MirrorStatus.WAITING -> if (isAmbient) AmbientLayout(state.frame!!) else FrameLayout(state.frame!!, muted = false)
        MirrorStatus.STALE -> if (isAmbient) AmbientLayout(state.frame!!) else FrameLayout(state.frame!!, muted = true)
        MirrorStatus.LIVE -> if (isAmbient) AmbientLayout(state.frame!!) else FrameLayout(state.frame!!, muted = false)
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
