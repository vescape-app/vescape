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
 * @parity /watch/watchos/MirrorScreen.swift `MirrorScreen`
 */
@Composable
internal fun MirrorScreen(
    sender: CommandSender,
    ambient: AmbientMode = AmbientOff,
    onRequestClose: () -> Unit = {},
) {
    val isAmbient = ambient.active
    val state by TelemetryState.mirrorState
    var showClosePrompt by remember { mutableStateOf(false) }
    var controlHeld by remember { mutableStateOf(false) }
    val joined by remember { derivedStateOf { GroupRideState.group.value != null } }
    val verticalPagerState = rememberPagerState(
        initialPage = VERTICAL_PAGE_GAUGES,
        pageCount = { if (joined) VERTICAL_PAGE_COUNT_JOINED else VERTICAL_PAGE_COUNT },
    )
    val verticalPosition = {
        verticalPagerState.currentPage + verticalPagerState.currentPageOffsetFraction
    }
    val navFocus = { (verticalPosition() - VERTICAL_PAGE_GAUGES).coerceIn(0f, 1f) }
    val groupFocus = { (verticalPosition() - VERTICAL_PAGE_NAV).coerceIn(0f, 1f) }
    val controlPagerState = rememberPagerState(pageCount = { CONTROL_PAGE_COUNT })
    val scope = rememberCoroutineScope()
    val rideNotice by RideNoticeState.card
    val onGauges = verticalPagerState.currentPage == VERTICAL_PAGE_GAUGES
    val radarVisible = !isAmbient && verticalPagerState.currentPage == VERTICAL_PAGE_RADAR
    val groupPageSettled by remember(verticalPagerState, isAmbient) {
        derivedStateOf {
            !isAmbient &&
                verticalPagerState.currentPage == VERTICAL_PAGE_GROUP &&
                !verticalPagerState.isScrollInProgress &&
                verticalPagerState.currentPageOffsetFraction == 0f
        }
    }

    BackHandler(enabled = showClosePrompt) {
        showClosePrompt = false
    }
    BackHandler(enabled = !showClosePrompt && !onGauges) {
        scope.launch { verticalPagerState.animateScrollToPage(VERTICAL_PAGE_GAUGES) }
    }
    BackHandler(enabled = !showClosePrompt && onGauges) {
        showClosePrompt = true
    }

    val hideRideNotice = {
        rideNotice?.let { notice ->
            MirrorIntakeState.apply { hideRideNotice(notice.id, notice.rev) }
            sender.sendDismissNotice(notice.id, notice.rev)
        }
        showClosePrompt = false
        scope.launch {
            verticalPagerState.scrollToPage(VERTICAL_PAGE_GAUGES)
            controlPagerState.scrollToPage(CONTROL_PAGE_GAUGES)
        }
        Unit
    }
    BackHandler(enabled = rideNotice != null, onBack = hideRideNotice)

    LaunchedEffect(joined) {
        if (!joined && verticalPagerState.currentPage > VERTICAL_PAGE_NAV) {
            verticalPagerState.scrollToPage(VERTICAL_PAGE_NAV)
        }
    }

    LaunchedEffect(isAmbient) {
        while (true) {
            delay(if (isAmbient) AMBIENT_REFRESH_INTERVAL_MS else WATCH_FRAME_INTERVAL_MS)
            TelemetryState.refresh()
        }
    }

    MaterialTheme(typography = WatchTypography.material) {
        Box(modifier = Modifier.fillMaxSize()) {
            when {
                showClosePrompt -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    ClosePrompt(onStay = { showClosePrompt = false }, onClose = onRequestClose)
                }
                else -> {
                    val dismissState = rememberSwipeToDismissBoxState()
                    var dismissEnabled by remember { mutableStateOf(true) }
                    var lastTouchMs by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
                    val controlFocus = {
                        (controlPagerState.currentPage + controlPagerState.currentPageOffsetFraction)
                            .coerceIn(0f, 1f)
                    }
                    val weatherFocus = { (VERTICAL_PAGE_GAUGES - verticalPosition()).coerceIn(0f, 1f) }
                    LaunchedEffect(isAmbient) {
                        if (!isAmbient) return@LaunchedEffect
                        verticalPagerState.scrollToPage(VERTICAL_PAGE_GAUGES)
                        controlPagerState.scrollToPage(CONTROL_PAGE_GAUGES)
                    }
                    val activePage by remember(controlPagerState) {
                        derivedStateOf {
                            controlPagerState.currentPage.takeIf {
                                !controlPagerState.isScrollInProgress &&
                                    controlPagerState.currentPageOffsetFraction == 0f
                            }
                        }
                    }
                    val weatherTappable by remember(controlPagerState, verticalPagerState, isAmbient) {
                        derivedStateOf {
                            !isAmbient &&
                                activePage == CONTROL_PAGE_GAUGES &&
                                !verticalPagerState.isScrollInProgress &&
                                verticalPagerState.currentPage == VERTICAL_PAGE_GAUGES
                        }
                    }
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
                    LaunchedEffect(lastTouchMs, controlHeld, isAmbient) {
                        if (controlHeld || isAmbient) return@LaunchedEffect
                        delay(CONTROL_IDLE_RETURN_MS)
                        if (controlPagerState.currentPage != CONTROL_PAGE_GAUGES) {
                            controlPagerState.animateScrollToPage(CONTROL_PAGE_GAUGES)
                        }
                    }
                    BasicSwipeToDismissBox(
                        onDismissed = { showClosePrompt = true },
                        state = dismissState,
                        userSwipeEnabled = dismissEnabled && !isAmbient,
                    ) { isBackground ->
                        Box(
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
                                    userScrollEnabled = !isAmbient && !controlHeld && activePage == CONTROL_PAGE_GAUGES,
                                    flingBehavior = PagerDefaults.flingBehavior(
                                        state = verticalPagerState,
                                        snapPositionalThreshold = PAGE_SNAP_THRESHOLD,
                                    ),
                                    modifier = Modifier.fillMaxSize(),
                                ) { verticalPage ->
                                    when (verticalPage) {
                                        VERTICAL_PAGE_RADAR -> RadarScreen(visible = radarVisible)
                                        VERTICAL_PAGE_WEATHER -> WeatherScreen()
                                        VERTICAL_PAGE_NAV -> Unit
                                        VERTICAL_PAGE_GROUP -> GroupRidePage(settled = groupPageSettled)
                                        else -> HorizontalPager(
                                            state = controlPagerState,
                                            userScrollEnabled = !isAmbient && !controlHeld,
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
                                                    CONTROL_PAGE_GAUGES -> Unit
                                                    CONTROL_PAGE_TILT -> TiltScreen(
                                                        sender = sender,
                                                        interactionEnabled = !isAmbient && activePage == CONTROL_PAGE_TILT,
                                                        onHoldChanged = { controlHeld = it },
                                                    )
                                                    CONTROL_PAGE_MOVE -> MoveScreen(
                                                        sender = sender,
                                                        interactionEnabled = !isAmbient && activePage == CONTROL_PAGE_MOVE,
                                                        onHoldChanged = { controlHeld = it },
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
                                MirrorContent(
                                    state = state,
                                    ambient = ambient,
                                    focus = navFocus,
                                    controlFocus = controlFocus,
                                    weatherFocus = weatherFocus,
                                    groupFocus = groupFocus,
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
            rideNotice?.let { RideNoticeCard(it, ambient, onTap = hideRideNotice) }
        }
    }
}

private const val PAGE_SNAP_THRESHOLD = 0.25f

private const val CONTROL_IDLE_RETURN_MS = 45_000L

private const val VERTICAL_PAGE_RADAR = 0
private const val VERTICAL_PAGE_WEATHER = 1
private const val VERTICAL_PAGE_GAUGES = 2
private const val VERTICAL_PAGE_NAV = 3
private const val VERTICAL_PAGE_GROUP = 4
private const val VERTICAL_PAGE_COUNT = 4
private const val VERTICAL_PAGE_COUNT_JOINED = VERTICAL_PAGE_GROUP + 1

private const val CONTROL_PAGE_GAUGES = 0
private const val CONTROL_PAGE_TILT = 1
private const val CONTROL_PAGE_MOVE = 2
private const val CONTROL_PAGE_LIGHTS = 3
private const val CONTROL_PAGE_DIAGNOSTICS = 4
private const val CONTROL_PAGE_COUNT = 5

@Composable
private fun MirrorContent(
    state: MirrorState,
    ambient: AmbientMode,
    focus: () -> Float = { 0f },
    controlFocus: () -> Float = { 0f },
    weatherFocus: () -> Float = { 0f },
    groupFocus: () -> Float = { 0f },
    onWeatherClick: (() -> Unit)? = null,
) {
    val link by TelemetryState.phoneLink
    val notice = MirrorStateReducer.linkNotice(state.status, link)
    FrameLayout(
        frame = state.frame ?: EMPTY_FRAME,
        muted = state.status == MirrorStatus.STALE,
        focus = focus,
        controlFocus = controlFocus,
        weatherFocus = weatherFocus,
        groupFocus = groupFocus,
        onWeatherClick = onWeatherClick,
        ambient = ambient,
        showReadouts = notice == null,
    )
    if (notice != null) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = fadeOut(maxOf(focus(), controlFocus(), weatherFocus())) },
            contentAlignment = Alignment.Center,
        ) {
            DisconnectedLayout(notice, ambient)
        }
    }
}

private val EMPTY_FRAME = WatchFrame(
    speed = null,
    duty = null,
    battery = null,
    motorTemp = null,
    ctrlTemp = null,
    stale = false,
)

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMirrorCoordinator.kt `WATCH_FRAME_AMBIENT_INTERVAL_MS`
 */
private const val AMBIENT_REFRESH_INTERVAL_MS = 10_000L
