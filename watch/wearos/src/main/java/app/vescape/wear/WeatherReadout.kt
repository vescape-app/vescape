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
 * A temperature with its degree mark tucked against the last digit. The ° hangs on the digits as an
 * overlay, so it never shifts where the number itself lands: "21°" and "20" share one centre, and
 * the mark is a tail, not part of the column.
 *
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

/** Shift that leaves a hair of space between the last digit and the mark.
 *
 * @parity /watch/watchos/WeatherGlyph.swift `degreeTuck`
 */
private const val DEGREE_TUCK = 0.45f

/**
 * The forecast strip under the wall clock on the gauges page: condition glyph and temperature, with
 * the chance of rain stacked under them whenever there is one. Sized to disappear into the rim gap —
 * a rider glancing at speed should register it without it competing with a gauge, which is also why
 * rain goes below rather than beside: a wider strip would reach into the speed and duty gauges.
 *
 * Renders nothing until the phone has pushed a forecast, so the layout above the gauges is unchanged
 * on a phone too old to send one. Tapping opens [WeatherScreen].
 *
 * @parity /watch/watchos/WeatherReadout.swift
 */
@Composable
internal fun WeatherReadout(muted: Boolean, onClick: (() -> Unit)?, modifier: Modifier = Modifier) {
    val forecast = freshWeather() ?: return
    val iconColor = if (muted) DimText else weatherColor(forecast.icon)
    val textColor = if (muted) DimText else SecondaryText

    Column(
        // Null while another page has the screen: the readout is drawn over the pagers so the tap
        // can reach it at all, and a target up there would swallow drags meant for them. A disabled
        // `clickable` still installs a pointer-input node, so the modifier has to be absent, not off.
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
            // All blue, glyph and number alike: rain is one reading, not an icon with a label.
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
