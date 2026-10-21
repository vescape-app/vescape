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
import expo.modules.vescapecore.location.GpsDisplayMotion
import expo.modules.vescapecore.watch.WatchMapPosition
import expo.modules.vescapecore.watch.WatchTrailPoint

/**
 * The heading-up map's position, zoom and course as the wrist currently draws them.
 * Position samples the phone's native display segment; zoom and course ease towards their targets. Route and trail share position motion; Group Ride shares zoom and course, so a Rider on the route
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
    fun moveTo(position: WatchMapPosition?, nowMs: Long, animate: Boolean, displayMotion: GpsDisplayMotion?) {
        if (position != motion.position || motion.sourceDisplayMotion != displayMotion || !animate) {
            motion = motion.retarget(position, nowMs, animate, displayMotion)
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
internal fun rememberWatchMapView(targetSpanM: Float, targetCourseDeg: Float?, animate: Boolean, position: WatchMapPosition? = null, displayMotion: GpsDisplayMotion? = null): WatchMapView {
    val view = remember { WatchMapView(targetSpanM, targetCourseDeg ?: 0f) }
    view.moveTo(position, System.currentTimeMillis(), animate, displayMotion)
    LaunchedEffect(view.motion) {
        while (view.motionTimeMs < view.motion.endsAtMs) {
            withFrameNanos { view.motionTimeMs = System.currentTimeMillis() }
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

/** Camera translation relative to the frame's absolute map anchor. One clock for both paths.
 * The anchor is absolute: rerouting, history trimming and skipped frames cannot change its origin.
 * @parity /modules/vescape-core/ios/watch/WatchMapView.swift `WatchMapMotion`
 */
internal data class WatchMapMotion(
    val position: WatchMapPosition? = null,
    private val from: WatchTrailPoint = WatchTrailPoint(0.0, 0.0),
    private val startsAtMs: Long = 0,
    val endsAtMs: Long = 0,
    val displayMotion: GpsDisplayMotion? = null,
    val sourceDisplayMotion: GpsDisplayMotion? = null,
) {
    fun offsetAt(nowMs: Long): WatchTrailPoint {
        if (displayMotion != null && position != null) {
            val (lat, lng) = displayMotion.positionAt(nowMs)
            return position.offsetFrom(WatchMapPosition(lat, lng))
        }
        val remaining = if (endsAtMs <= startsAtMs) 0.0 else
            ((endsAtMs - nowMs).toDouble() / (endsAtMs - startsAtMs)).coerceIn(0.0, 1.0)
        return WatchTrailPoint(from.eastM * remaining, from.northM * remaining)
    }

    fun retarget(target: WatchMapPosition?, nowMs: Long, animate: Boolean, displayMotion: GpsDisplayMotion? = null): WatchMapMotion {
        if (animate && target != null && displayMotion != null) {
            if (sourceDisplayMotion == displayMotion && position == target) return this
            val current = this.displayMotion?.positionAt(nowMs) ?: position?.let { anchor ->
                val offset = offsetAt(nowMs)
                Pair(anchor.latitude - offset.northM / 110_574,
                    anchor.longitude - offset.eastM / (111_320 * maxOf(0.001, kotlin.math.cos(Math.toRadians(anchor.latitude)))))
            } ?: displayMotion.positionAt(nowMs)
            val duration = maxOf(GpsDisplayMotion.MIN_CORRECTION_MS, displayMotion.endsAtMs - nowMs)
            val desired = displayMotion.positionAt(nowMs)
            val remaining = if (displayMotion.endsAtMs > nowMs && displayMotion.endsAtMs > displayMotion.startsAtMs)
                (displayMotion.endsAtMs - nowMs).toDouble() / (displayMotion.endsAtMs - displayMotion.startsAtMs) else 0.0
            val local = if (displayMotion.resetPosition) displayMotion else GpsDisplayMotion(current.first, current.second,
                desired.first + (displayMotion.toLatitude - displayMotion.fromLatitude) * remaining,
                desired.second + GpsDisplayMotion.longitudeDelta(displayMotion.fromLongitude, displayMotion.toLongitude) * remaining,
                nowMs, nowMs + duration, false, displayMotion.latitudePerMs, displayMotion.longitudePerMs,
                displayMotion.velocityExpiresAtMs)
            return WatchMapMotion(position = target, endsAtMs = maxOf(nowMs + duration, if (displayMotion.latitudePerMs != 0.0 || displayMotion.longitudePerMs != 0.0) displayMotion.velocityExpiresAtMs else nowMs),
                displayMotion = local, sourceDisplayMotion = displayMotion)
        }
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
