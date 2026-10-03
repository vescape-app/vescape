package app.vescape.wear

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.withFrameNanos
import android.os.SystemClock
import expo.modules.vescapecore.watch.WatchMapPosition
import expo.modules.vescapecore.watch.WatchTrailPoint

/**
 * The heading-up map's position, zoom and course as the wrist currently draws them, eased towards the latest
 * target. Route and trail share position motion; Group Ride shares zoom and course, so a Rider on the route
 * stays on it mid-zoom and mid-turn. Read [spanM] and [courseDeg] in a draw scope: an easing then
 * repaints the map layers without recomposing anything.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapView.swift `WatchMapView`
 * @platform-diff Compose `Animatable`s here. watchOS interpolates on a `TimelineView` instead,
 *   because a `Canvas` cannot read a shape's `animatableData`.
 */
@Stable
internal class WatchMapView(spanM: Float, courseDeg: Float) {
    var motion by mutableStateOf(WatchMapMotion())
        private set
    var motionTimeMs by mutableStateOf(0L)
    val positionOffset: WatchTrailPoint get() = motion.offsetAt(motionTimeMs)

    // Retarget in the same composition as the new geometry, before either layer can draw it.
    fun moveTo(position: WatchMapPosition?, nowMs: Long, animate: Boolean) {
        if (position != motion.position || !animate) {
            motion = motion.retarget(position, nowMs, animate)
            motionTimeMs = nowMs
        }
    }

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
internal fun rememberWatchMapView(targetSpanM: Float, targetCourseDeg: Float?, animate: Boolean, position: WatchMapPosition? = null): WatchMapView {
    val view = remember { WatchMapView(targetSpanM, targetCourseDeg ?: 0f) }
    view.moveTo(position, SystemClock.uptimeMillis(), animate)
    LaunchedEffect(view.motion) {
        while (view.motionTimeMs < view.motion.endsAtMs) {
            withFrameNanos { view.motionTimeMs = SystemClock.uptimeMillis() }
        }
    }
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

/** Remaining camera translation relative to the latest GPS fix. One clock for both paths.
 * The anchor is absolute: rerouting, history trimming and skipped frames cannot change its origin.
 * @parity /modules/vescape-core/ios/watch/WatchMapView.swift `WatchMapMotion`
 */
internal data class WatchMapMotion(
    val position: WatchMapPosition? = null,
    private val from: WatchTrailPoint = WatchTrailPoint(0.0, 0.0),
    private val startsAtMs: Long = 0,
    val endsAtMs: Long = 0,
) {
    fun offsetAt(nowMs: Long): WatchTrailPoint {
        val remaining = if (endsAtMs <= startsAtMs) 0.0 else
            ((endsAtMs - nowMs).toDouble() / (endsAtMs - startsAtMs)).coerceIn(0.0, 1.0)
        return WatchTrailPoint(from.eastM * remaining, from.northM * remaining)
    }

    fun retarget(target: WatchMapPosition?, nowMs: Long, animate: Boolean): WatchMapMotion {
        if (!animate || target == null || position == null) return WatchMapMotion(position = target)
        if (target == position) return this
        val movement = target.offsetFrom(position)
        val remaining = offsetAt(nowMs)
        return WatchMapMotion(target,
            WatchTrailPoint(remaining.eastM + movement.eastM, remaining.northM + movement.northM),
            nowMs, nowMs + 300,
        )
    }
}

/** Grow the newest segment from the pinned rider while history moves with the camera.
 * Trim at most the pending camera distance from the newest suffix, then pin the tip to the ring.
 * Direction alone cannot identify new points: older history may be ahead after a U-turn.
 * @parity /modules/vescape-core/ios/watch/WatchMapView.swift `movingTrail`
 */
internal fun movingTrail(points: List<WatchTrailPoint>, offset: WatchTrailPoint): List<WatchTrailPoint> {
    val shifted = points.map { WatchTrailPoint(it.eastM + offset.eastM, it.northM + offset.northM) }
    val tip = points.lastOrNull() ?: return shifted
    if (kotlin.math.hypot(tip.eastM, tip.northM) > 0.01) return shifted
    var end = points.lastIndex
    var remaining = kotlin.math.hypot(offset.eastM, offset.northM)
    // Always retain the oldest point. A short/sampled history must not vanish during motion.
    while (end > 1) {
        val segment = kotlin.math.hypot(
            points[end].eastM - points[end - 1].eastM,
            points[end].northM - points[end - 1].northM,
        )
        if (segment > remaining) break
        remaining -= segment
        end--
    }
    return shifted.take(end) + WatchTrailPoint(0.0, 0.0)
}
