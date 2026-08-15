package app.vescape.wear

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
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
 * Structure is carried by hairlines rather than boxes: a rule that fades out at both ends separates
 * the hero from the strip without butting into the round bezel, and sun times close the page under
 * it. Everything is a 1 dp [GuideColor] stroke or a tinted glyph — no fills, per `docs/design.md`.
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
                modifier = Modifier.padding(start = 8.dp),
            )
        }
        Text(
            text = forecast.label.uppercase(),
            style = MaterialTheme.typography.caption3.copy(letterSpacing = LABEL_TRACKING),
            color = SecondaryText,
            textAlign = TextAlign.Center,
        )
        if (forecast.precipitationProbability > 0) {
            Spacer(modifier = Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    painter = painterResource(R.drawable.ic_ph_drop),
                    contentDescription = null,
                    tint = weatherColor("cloud-rain"),
                    modifier = Modifier.size(11.dp),
                )
                Text(
                    text = "${forecast.precipitationProbability}% rain",
                    style = MaterialTheme.typography.caption2,
                    color = weatherColor("cloud-rain"),
                    modifier = Modifier.padding(start = 4.dp),
                )
            }
        }
        Spacer(modifier = Modifier.height(FORECAST_GAP))
        FadingRule(modifier = Modifier.fillMaxWidth().padding(horizontal = RULE_INSET))
        Spacer(modifier = Modifier.height(12.dp))
        LazyRow(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(HOUR_GAP),
        ) {
            items(forecast.hourly, key = { it.minuteOfDay }) { hour -> HourColumn(hour) }
        }
        if (forecast.sunriseMinuteOfDay != null && forecast.sunsetMinuteOfDay != null) {
            Spacer(modifier = Modifier.height(SUN_TIMES_GAP))
            Row(verticalAlignment = Alignment.CenterVertically) {
                SunTime(forecast.sunriseMinuteOfDay, rising = true)
                Box(
                    modifier = Modifier
                        .padding(horizontal = 10.dp)
                        .width(1.dp)
                        .height(10.dp)
                        .background(GuideColor),
                )
                SunTime(forecast.sunsetMinuteOfDay, rising = false)
            }
        }
    }
}

/** One forecast hour: time, glyph, temperature, and chance of rain. */
@Composable
private fun HourColumn(hour: WatchWeatherHour) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            text = formatHour(hour.minuteOfDay),
            style = MaterialTheme.typography.caption3,
            color = DimText,
        )
        Icon(
            painter = painterResource(weatherIconRes(hour.icon)),
            contentDescription = null,
            tint = weatherColor(hour.icon),
            modifier = Modifier.size(HOUR_ICON_SIZE),
        )
        Text(
            text = "${hour.temperatureC}°",
            style = MaterialTheme.typography.caption2,
            color = SecondaryText,
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

/**
 * Sunrise or sunset, mirroring the phone's expanded weather pill: a sun glyph with a caret for the
 * direction, amber going up and violet going down.
 *
 * @parity /src/modules/weather/components/WeatherPillView.tsx `sunTimes`
 */
@Composable
private fun SunTime(minuteOfDay: Int, rising: Boolean) {
    val tint = if (rising) weatherColor("sun") else weatherColor("moon")
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            painter = painterResource(R.drawable.ic_ph_sun),
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(12.dp),
        )
        Icon(
            painter = painterResource(if (rising) R.drawable.ic_caret_up else R.drawable.ic_caret_down),
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(8.dp),
        )
        Text(
            text = formatHour(minuteOfDay),
            style = MaterialTheme.typography.caption3,
            color = SecondaryText,
            modifier = Modifier.padding(start = 2.dp),
        )
    }
}

/** A 1 dp rule that fades to nothing at both ends, so it never butts into the round bezel. */
@Composable
private fun FadingRule(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .height(1.dp)
            .background(
                Brush.horizontalGradient(
                    listOf(Color.Transparent, GuideColor, GuideColor, Color.Transparent),
                ),
            ),
    )
}

private val HERO_ICON_SIZE = 32.dp
private val CURRENT_TOP_PADDING = 30.dp
private val LABEL_TRACKING = 1.2.sp
private val FORECAST_GAP = 14.dp
private val RULE_INSET = 30.dp
private val SUN_TIMES_GAP = 10.dp
private val HOUR_GAP = 12.dp
private val HOUR_ICON_SIZE = 20.dp
private val HOUR_PRECIP_FONT_SIZE = 10.sp
