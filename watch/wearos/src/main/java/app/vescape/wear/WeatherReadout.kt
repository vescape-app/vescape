package app.vescape.wear

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text

/**
 * @parity /watch/watchos/WeatherGlyph.swift `DegreeNumber`
 */
@Composable
internal fun DegreeTemp(value: Int, style: TextStyle, color: Color, modifier: Modifier = Modifier) {
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        Text(text = value.toString(), style = style, color = color)
        Text(
            text = "°",
            style = style,
            color = color,
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .offset(x = style.fontSize.value.dp * DEGREE_TUCK),
        )
    }
}

/**
 * @parity /watch/watchos/WeatherGlyph.swift `degreeTuck`
 */
private const val DEGREE_TUCK = 0.45f

/**
 * @parity /watch/watchos/WeatherReadout.swift
 */
@Composable
internal fun WeatherReadout(muted: Boolean, onClick: (() -> Unit)?, modifier: Modifier = Modifier) {
    val forecast = freshWeather() ?: return
    val iconColor = if (muted) DimText else weatherColor(forecast.icon)
    val textColor = if (muted) DimText else SecondaryText

    Column(
        modifier = modifier
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                painter = painterResource(weatherIconRes(forecast.icon)),
                contentDescription = forecast.label,
                tint = iconColor,
                modifier = Modifier.size(READOUT_ICON_SIZE),
            )
            DegreeTemp(
                value = forecast.temperatureC,
                style = WatchTypography.mono(MaterialTheme.typography.caption2.copy(fontSize = READOUT_FONT_SIZE)),
                color = textColor,
                modifier = Modifier.padding(start = 3.dp),
            )
        }
        if (forecast.precipitationProbability > 0) {
            val rainColor = if (muted) DimText else weatherColor("cloud-rain")
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    painter = painterResource(R.drawable.ic_ph_drop),
                    contentDescription = null,
                    tint = rainColor,
                    modifier = Modifier.size(READOUT_DROP_SIZE),
                )
                Text(
                    text = "${forecast.precipitationProbability}%",
                    style = WatchTypography.mono(MaterialTheme.typography.caption2.copy(fontSize = RAIN_FONT_SIZE)),
                    color = rainColor,
                    modifier = Modifier.padding(start = 1.dp),
                )
            }
        }
    }
}

private val READOUT_ICON_SIZE = 13.dp
private val READOUT_DROP_SIZE = 8.dp
private val READOUT_FONT_SIZE = 11.sp
private val RAIN_FONT_SIZE = 9.sp
