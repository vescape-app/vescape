package app.vescape.wear

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text

/**
 * No fresh frames: name the reason from the watch-local [PhoneLink] instead of an anonymous
 * spinner, so "Bluetooth to phone is down" and "phone app missing" and "app just isn't riding"
 * are distinguishable at a glance.
 */
@Composable
internal fun DisconnectedLayout(isAmbient: Boolean) {
    if (isAmbient) {
        AmbientPlaceholder()
        return
    }

    val link by TelemetryState.phoneLink
    val (title, caption) = when (link) {
        PhoneLink.UNKNOWN -> "Connecting…" to ""
        PhoneLink.NO_PHONE -> "No phone link" to "Check Bluetooth"
        PhoneLink.PHONE_ONLY -> "Phone linked" to "Vescape app not found"
        PhoneLink.APP_REACHABLE -> "Phone connected" to "No board session"
    }
    StatusLayout(title = title, caption = caption, spin = link != PhoneLink.NO_PHONE)
}

/** Phone session live, board telemetry not flowing yet. */
@Composable
internal fun WaitingLayout(isAmbient: Boolean) {
    if (isAmbient) {
        AmbientPlaceholder()
        return
    }
    StatusLayout(title = "Board connecting…", caption = "Waiting for telemetry", spin = true)
}

/** Ambient stand-in while there is no frame to show: a dim dash hero. */
@Composable
private fun AmbientPlaceholder() {
    Text(
        text = DASH,
        style = MaterialTheme.typography.display1,
        color = AmbientText,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun StatusLayout(title: String, caption: String, spin: Boolean) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        if (spin) {
            CircularProgressIndicator(
                modifier = Modifier.fillMaxSize().padding(8.dp),
                indicatorColor = SpeedColor,
                trackColor = GuideColor,
                strokeWidth = 4.dp,
            )
        }
        Column(
            modifier = Modifier.padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.title3,
                color = PrimaryText,
                textAlign = TextAlign.Center,
            )
            if (caption.isNotEmpty()) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = caption,
                    style = MaterialTheme.typography.caption2,
                    color = SecondaryText,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}
