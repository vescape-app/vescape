package app.vescape.wear

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text

/**
 * Forecast page above the gauges. Current conditions are the hero; every hour sent by the phone is
 * available in a horizontal strip, matching the phone forecast without fighting the vertical page
 * gesture back to telemetry.
 *
 * Read-only, like every wrist surface: the phone owns the forecast and there is no way to ask it for
 * a fresher one from here (ADR-0019 keeps the mirror one-way for data).
 */
@Composable
fun WeatherScreen() {
    val forecast = freshWeather()

    if (forecast == null) {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "No forecast",
                style = MaterialTheme.typography.body2,
                color = SecondaryText,
                textAlign = TextAlign.Center,
            )
        }
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(top = CURRENT_TOP_PADDING),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Top,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                painter = painterResource(weatherIconRes(forecast.icon)),
                contentDescription = forecast.label,
                tint = weatherColor(forecast.icon),
                modifier = Modifier.size(HERO_ICON_SIZE),
            )
            Text(
                text = "${forecast.temperatureC}°",
                style = MaterialTheme.typography.display2,
                color = PrimaryText,
                modifier = Modifier.padding(start = 6.dp),
            )
        }
        Text(
            text = forecast.label,
            style = MaterialTheme.typography.caption1,
            color = SecondaryText,
            textAlign = TextAlign.Center,
        )
        if (forecast.precipitationProbability > 0) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    painter = painterResource(R.drawable.ic_ph_drop),
                    contentDescription = null,
                    tint = weatherColor("cloud-rain"),
                    modifier = Modifier.size(12.dp),
                )
                Text(
                    text = "${forecast.precipitationProbability}% rain",
                    style = MaterialTheme.typography.caption2,
                    color = weatherColor("cloud-rain"),
                    modifier = Modifier.padding(start = 3.dp),
                )
            }
        }
        Spacer(modifier = Modifier.height(FORECAST_GAP))
        LazyRow(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items(forecast.hourly, key = { it.minuteOfDay }) { hour ->
                HourColumn(hour = hour, modifier = Modifier.width(HOUR_ITEM_WIDTH))
            }
        }
    }
}

/** One forecast hour: time, glyph, temperature, and chance of rain. */
@Composable
private fun HourColumn(hour: WatchWeatherHour, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            text = formatHour(hour.minuteOfDay),
            style = MaterialTheme.typography.caption2.copy(fontSize = HOUR_FONT_SIZE),
            color = SecondaryText,
        )
        Icon(
            painter = painterResource(weatherIconRes(hour.icon)),
            contentDescription = null,
            tint = weatherColor(hour.icon),
            modifier = Modifier.size(HOUR_ICON_SIZE),
        )
        Text(
            text = "${hour.temperatureC}°",
            style = MaterialTheme.typography.caption2.copy(fontSize = HOUR_FONT_SIZE),
            color = PrimaryText,
        )
        if (hour.precipitationProbability > 0) {
            Text(
                text = "${hour.precipitationProbability}%",
                style = MaterialTheme.typography.caption3.copy(fontSize = HOUR_PRECIP_FONT_SIZE),
                color = weatherColor("cloud-rain"),
            )
        } else {
            Spacer(modifier = Modifier.height(HOUR_PRECIP_FONT_SIZE.value.dp))
        }
    }
}

private val HERO_ICON_SIZE = 34.dp
private val CURRENT_TOP_PADDING = 42.dp
private val FORECAST_GAP = 26.dp
private val HOUR_ITEM_WIDTH = 54.dp
private val HOUR_ICON_SIZE = 22.dp
private val HOUR_FONT_SIZE = 15.sp
private val HOUR_PRECIP_FONT_SIZE = 11.sp
