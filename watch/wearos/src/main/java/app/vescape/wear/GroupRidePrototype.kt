package app.vescape.wear

// PROTOTYPE — throwaway reference for PRD #524 (issues #525–#529). Mock Group Ride riders and the hooks
// the Mirror reads; the design itself is in GroupRidePrototypeUi.kt. Run with `bun run wear:replay`.
// Implementation tasks use it as the example to match and must not extend it. A task may unhook a
// `PROTOTYPE` hook in MirrorScreen/FrameGauges where the real code takes its place. The final cleanup
// issue deletes both files and any remaining hooks once every task has landed.

import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.sin

/**
 * One fellow rider as the wrist would receive it. [bearingDeg] is relative to *my* direction of
 * travel (0 = straight ahead, 90 = right, 180 = behind), same convention as the nav chevron.
 * [battery] is the Battery SoC Estimate (null = no Board Session). [overheating] does not exist in
 * Rider Presence today — the prototype assumes the phone would add a motor/controller-hot flag.
 * [stale] = no presence for a while (lost signal), not yet dropped from the Group Ride.
 */
internal data class ProtoRider(
    val id: String,
    val name: String,
    val color: Color,
    val bearingDeg: Float,
    val distanceM: Double,
    val battery: Int?,
    val overheating: Boolean,
    val stale: Boolean,
) {
    val lowBattery: Boolean get() = battery != null && battery < LOW_BATTERY_PERCENT
    val needsAttention: Boolean get() = lowBattery || overheating
}

internal const val LOW_BATTERY_PERCENT = 20

/** Everything the Group Ride UI draws with. Focus lambdas are the same ones [FrameLayout] reads. */
internal class GroupRideProtoScope(
    val riders: List<ProtoRider>,
    /** 0 on the gauges, 1 once the nav-focus page (swipe up from gauges) has settled. */
    val navFocus: () -> Float,
    /** Any page other than the gauges/nav taking the centre: overlays should fade with this. */
    val otherFocus: () -> Float,
    val ambient: AmbientMode,
)

internal object GroupRidePrototype {
    /** Latest scope, so [FrameLayout] can draw the underlay between the map and the gauges. */
    var scope by mutableStateOf<GroupRideProtoScope?>(null)

    /** 0 off the Group Ride page, 1 on it. Set by MirrorScreen; FrameLayout hides the map with it. */
    var pageFocus: () -> Float = { 0f }

    private val clockMs = mutableLongStateOf(SystemClock.elapsedRealtime())

    /** Riders drift slowly so distances, bearings and warnings move like a real ride. */
    val riders: List<ProtoRider>
        get() {
            val t = clockMs.longValue / 1000.0
            fun wave(periodS: Double, phase: Double = 0.0) = sin(2 * PI * t / periodS + phase)
            return listOf(
                ProtoRider("ola", "Ola", Color(0xFF38BDF8), (-18 + 10 * wave(23.0)).toFloat(), 140 + 60 * wave(31.0), 78, overheating = false, stale = false),
                ProtoRider("marek", "Marek", Color(0xFFF472B6), (150 + 12 * wave(19.0, 1.0)).toFloat(), 820 + 150 * wave(41.0), 14, overheating = false, stale = false),
                ProtoRider("kuba", "Kuba", Color(0xFFFACC15), (62 + 8 * wave(27.0, 2.0)).toFloat(), 2350 + 300 * wave(53.0), 55, overheating = wave(20.0) > 0, stale = false),
                ProtoRider("tomek", "Tomek", Color(0xFFA78BFA), (125 + 25 * wave(11.0, 4.0)).toFloat(), 22 + 10 * wave(9.0), 62, overheating = false, stale = false),
                ProtoRider("ania", "Ania", Color(0xFF4ADE80), (-100 + 20 * wave(17.0, 3.0)).toFloat(), 45 + 20 * wave(13.0), null, overheating = false, stale = true),
            )
        }

    @Composable
    fun Tick() {
        LaunchedEffect(Unit) {
            while (true) {
                delay(500)
                clockMs.longValue = SystemClock.elapsedRealtime()
            }
        }
    }
}

