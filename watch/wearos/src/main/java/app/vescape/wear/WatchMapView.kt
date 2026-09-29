package app.vescape.wear

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember

/**
 * The heading-up map's zoom and course as the wrist currently draws them, eased towards the latest
 * target. The route and the Group Ride marks all project with these numbers, so a Rider on the route
 * stays on it mid-zoom and mid-turn. Read [spanM] and [courseDeg] in a draw scope: an easing then
 * repaints the map layers without recomposing anything.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapView.swift `WatchMapView`
 * @platform-diff Compose `Animatable`s here. watchOS interpolates on a `TimelineView` instead,
 *   because a `Canvas` cannot read a shape's `animatableData`.
 */
@Stable
internal class WatchMapView(spanM: Float, courseDeg: Float) {
    private val span = Animatable(spanM)
    private val course = Animatable(courseDeg)

    /** Metres across the face, already clamped. */
    val spanM: Float get() = span.value

    /** Unwrapped, so a heading crossing north turns the short way; [relativeBearingDeg] wraps it. */
    val courseDeg: Float get() = course.value

    suspend fun zoomTo(spanM: Float, animate: Boolean) {
        if (animate) span.animateTo(spanM, tween(MAP_ZOOM_EASE_MS, easing = FastOutSlowInEasing)) else span.snapTo(spanM)
    }

    suspend fun turnTo(courseDeg: Float, animate: Boolean) {
        val unwrapped = course.value + shortestAngleDelta(course.value, courseDeg)
        if (animate) course.animateTo(unwrapped, tween(MAP_TURN_EASE_MS, easing = LinearEasing)) else course.snapTo(unwrapped)
    }
}

/**
 * The frame layout's one [WatchMapView], eased towards [targetSpanM] (already clamped) and
 * [targetCourseDeg]. A null course holds the last one (a stop, an approximate fix). Without
 * [animate] it snaps, so a map nobody draws never runs the frame clock.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapView.swift `retarget`
 */
@Composable
internal fun rememberWatchMapView(targetSpanM: Float, targetCourseDeg: Float?, animate: Boolean): WatchMapView {
    val view = remember { WatchMapView(targetSpanM, targetCourseDeg ?: 0f) }
    LaunchedEffect(targetSpanM, animate) { view.zoomTo(targetSpanM, animate) }
    LaunchedEffect(targetCourseDeg, animate) { targetCourseDeg?.let { view.turnTo(it, animate) } }
    return view
}

/**
 * Shortest turn between two compass headings, in degrees, signed.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapView.swift `shortestAngleDelta`
 */
internal fun shortestAngleDelta(fromDeg: Float, toDeg: Float): Float =
    (((toDeg - fromDeg + 180f) % 360f + 360f) % 360f) - 180f

/** @parity /modules/vescape-core/ios/watch/WatchMapView.swift `zoomEase` */
private const val MAP_ZOOM_EASE_MS = 350

/** @parity /modules/vescape-core/ios/watch/WatchMapView.swift `turnEase` */
private const val MAP_TURN_EASE_MS = 300
