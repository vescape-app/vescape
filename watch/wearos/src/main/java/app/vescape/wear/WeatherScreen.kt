package app.vescape.wear

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text

/**
 * The forecast in full, opened by tapping [WeatherReadout]. Current conditions as a hero, then the
 * hours the phone sent — enough for a rider stopped at a light to decide whether to keep going.
 *
 * Read-only, like every wrist surface: the phone owns the forecast and there is no way to ask it for
 * a fresher one from here (ADR-0019 keeps the mirror one-way for data).
 */
@Composable
fun WeatherScreen() {
    val weather by WeatherState.weather
    val forecast = weather

    if (forecast == null) {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "No forecast yet",
                style = MaterialTheme.typography.body2,
                color = SecondaryText,
                textAlign = TextAlign.Center,
            )
        }
        return
    }

    ScalingLazyColumn(modifier = Modifier.fillMaxSize()) {
        item {
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
        }
        item {
            Text(
                text = forecast.label,
                style = MaterialTheme.typography.caption1,
                color = SecondaryText,
                textAlign = TextAlign.Center,
            )
        }
        if (forecast.precipitationProbability > 0) {
            item {
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
        }
        for (hour in forecast.hourly) {
            item { HourRow(hour) }
        }
    }
}

/** One forecast hour: time, glyph, temperature, and the chance of rain when there is one. */
@Composable
private fun HourRow(hour: WatchWeatherHour) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
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
            modifier = Modifier.padding(start = 8.dp).size(14.dp),
        )
        Text(
            text = "${hour.temperatureC}°",
            style = MaterialTheme.typography.caption2.copy(fontSize = HOUR_FONT_SIZE),
            color = PrimaryText,
            modifier = Modifier.padding(start = 6.dp),
        )
        if (hour.precipitationProbability > 0) {
            Text(
                text = "${hour.precipitationProbability}%",
                style = MaterialTheme.typography.caption3.copy(fontSize = HOUR_PRECIP_FONT_SIZE),
                color = weatherColor("cloud-rain"),
                modifier = Modifier.padding(start = 6.dp),
            )
        }
    }
}

private val HERO_ICON_SIZE = 30.dp
private val HOUR_FONT_SIZE = 13.sp
private val HOUR_PRECIP_FONT_SIZE = 10.sp
