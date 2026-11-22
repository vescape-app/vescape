package app.vescape.wear

import android.content.Context
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import expo.modules.vescapecore.watch.RideNoticeFrameItem
import expo.modules.vescapecore.watch.RideNoticeFrameSeverity
import androidx.annotation.MainThread

/**
 * @parity /watch/watchos/PhoneLink.swift `rideNoticeCard`
 */
@MainThread
internal object RideNoticeState {
    val card = mutableStateOf<RideNoticeFrameItem?>(null)
    private var vibrator: Vibrator? = null

    fun attach(context: Context) {
        if (vibrator == null) vibrator = context.applicationContext.getSystemService(Vibrator::class.java)
    }

    fun buzz() {
        vibrator?.vibrate(VibrationEffect.createWaveform(RIDE_NOTICE_BUZZ_MS, -1))
    }
}

private val RIDE_NOTICE_BUZZ_MS = longArrayOf(0, 180, 120, 180)

/**
 * @parity /watch/watchos/RideNoticeCard.swift `RideNoticeCard`
 */
@Composable
internal fun RideNoticeCard(notice: RideNoticeFrameItem, ambient: AmbientMode, onTap: () -> Unit) {
    val color = if (ambient.active) AmbientText else rideNoticeColor(notice.severity)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .border(if (ambient.active) 1.dp else 4.dp, color, CircleShape)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onTap)
            .padding(horizontal = 28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = notice.title,
            style = MaterialTheme.typography.title2,
            color = color,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        if (notice.details.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text(
                text = notice.details,
                style = MaterialTheme.typography.body2,
                color = if (ambient.active) AmbientText else PrimaryText,
                textAlign = TextAlign.Center,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** @parity /watch/watchos/RideNoticeCard.swift `rideNoticeColor` */
private fun rideNoticeColor(severity: RideNoticeFrameSeverity): Color = when (severity) {
    RideNoticeFrameSeverity.CRITICAL -> CriticalColor
    RideNoticeFrameSeverity.WARNING -> WarningColor
    RideNoticeFrameSeverity.INFO -> SpeedColor
}
