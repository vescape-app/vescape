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
 * @parity /watch/watchos/WeatherScreen.swift
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

    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(top = CURRENT_TOP_PADDING, bottom = PAGE_INSET),
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
                DegreeTemp(
                    value = forecast.temperatureC,
                    style = WatchTypography.mono(MaterialTheme.typography.display3),
                    color = PrimaryText,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            Text(
                text = forecast.label.uppercase(),
                style = MaterialTheme.typography.caption3.copy(letterSpacing = LABEL_TRACKING),
                color = SecondaryText,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = PAGE_INSET),
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
                        style = WatchTypography.mono(MaterialTheme.typography.caption2),
                        color = weatherColor("cloud-rain"),
                        modifier = Modifier.padding(start = 4.dp),
                    )
                }
            }
            Spacer(modifier = Modifier.weight(1f))
            FadingRule(modifier = Modifier.fillMaxWidth().padding(horizontal = PAGE_INSET + RULE_INSET))
            Spacer(modifier = Modifier.weight(1f))
            LazyRow(
                modifier = Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = STRIP_INSET),
                horizontalArrangement = Arrangement.spacedBy(HOUR_GAP),
            ) {
                items(forecast.hourly, key = { it.minuteOfDay }) { hour -> HourColumn(hour) }
            }
            val nextSunEvent = nextSunEvent(forecast.sunriseMinuteOfDay, forecast.sunsetMinuteOfDay)
            if (nextSunEvent != null) {
                Spacer(modifier = Modifier.weight(1f))
                SunTime(nextSunEvent.minuteOfDay, rising = nextSunEvent.rising)
            }
        }
        RadarHint(modifier = Modifier.align(Alignment.TopCenter).padding(top = RADAR_HINT_TOP_PADDING))
    }
}

@Composable
private fun RadarHint(modifier: Modifier = Modifier) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(
            painter = painterResource(R.drawable.ic_ph_caret_up),
            contentDescription = null,
            tint = DimText,
            modifier = Modifier.size(RADAR_HINT_CARET_SIZE),
        )
        Icon(
            painter = painterResource(R.drawable.ic_ph_target),
            contentDescription = "Rain radar above",
            tint = DimText,
            modifier = Modifier.size(RADAR_HINT_ICON_SIZE),
        )
    }
}

@Composable
private fun HourColumn(hour: WatchWeatherHour) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            text = formatHour(hour.minuteOfDay, SettingsState.settings.value.timeFormat),
            style = WatchTypography.mono(MaterialTheme.typography.caption3),
            color = DimText,
        )
        Icon(
            painter = painterResource(weatherIconRes(hour.icon)),
            contentDescription = null,
            tint = weatherColor(hour.icon),
            modifier = Modifier.size(HOUR_ICON_SIZE),
        )
        DegreeTemp(
            value = hour.temperatureC,
            style = WatchTypography.mono(MaterialTheme.typography.caption2),
            color = SecondaryText,
        )
        if (hour.precipitationProbability > 0) {
            Text(
                text = "${hour.precipitationProbability}%",
                style = WatchTypography.mono(MaterialTheme.typography.caption3.copy(fontSize = HOUR_PRECIP_FONT_SIZE)),
                color = weatherColor("cloud-rain"),
            )
        } else {
            Spacer(modifier = Modifier.height(HOUR_PRECIP_FONT_SIZE.value.dp))
        }
    }
}

private data class SunEvent(val minuteOfDay: Int, val rising: Boolean)

@Composable
private fun nextSunEvent(sunriseMinuteOfDay: Int?, sunsetMinuteOfDay: Int?): SunEvent? {
    val nowMinuteOfDay = currentMinuteOfDay()
    return when {
        sunriseMinuteOfDay != null && nowMinuteOfDay < sunriseMinuteOfDay ->
            SunEvent(sunriseMinuteOfDay, rising = true)
        sunsetMinuteOfDay != null && nowMinuteOfDay < sunsetMinuteOfDay ->
            SunEvent(sunsetMinuteOfDay, rising = false)
        sunriseMinuteOfDay != null -> SunEvent(sunriseMinuteOfDay, rising = true)
        else -> sunsetMinuteOfDay?.let { SunEvent(it, rising = false) }
    }
}

/**
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
            painter = painterResource(if (rising) R.drawable.ic_ph_caret_up else R.drawable.ic_ph_caret_down),
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(8.dp),
        )
        Text(
            text = formatHour(minuteOfDay, SettingsState.settings.value.timeFormat),
            style = WatchTypography.mono(MaterialTheme.typography.caption3),
            color = SecondaryText,
            modifier = Modifier.padding(start = 2.dp),
        )
    }
}

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

private val PAGE_INSET = GAUGE_INNER_INSET + 8.dp

private val STRIP_INSET = PAGE_INSET + 12.dp

private val RADAR_HINT_TOP_PADDING = 8.dp
private val RADAR_HINT_CARET_SIZE = 8.dp
private val RADAR_HINT_ICON_SIZE = 11.dp

private val HERO_ICON_SIZE = 26.dp
private val CURRENT_TOP_PADDING = 34.dp
private val LABEL_TRACKING = 1.2.sp
private val RULE_INSET = 14.dp
private val HOUR_GAP = 10.dp
private val HOUR_ICON_SIZE = 18.dp
private val HOUR_PRECIP_FONT_SIZE = 10.sp
