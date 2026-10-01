package app.vescape.wear

import expo.modules.vescapecore.watch.GeoPoint
import expo.modules.vescapecore.watch.WatchFrameBuilder
import expo.modules.vescapecore.watch.WatchRouteEncoder
import expo.modules.vescapecore.watch.WatchTiltControl as PhoneTiltControl
import expo.modules.vescapecore.watch.WatchFrame as PhoneFrame

/** Fixtures stand in for phone wire delivery, never write view stores directly.
 * @parity /modules/vescape-core/ios/watch/WatchMirrorReplayAdapter.swift
 */
internal object WatchMirrorReplayAdapter {
    fun telemetry(frame: WatchFrame): ByteArray {
        val bytes = WatchFrameBuilder.encode(PhoneFrame(
            speed = frame.speed, duty = frame.duty, battery = frame.battery,
            motorTemp = frame.motorTemp, ctrlTemp = frame.ctrlTemp, stale = frame.stale,
            navBearing = frame.navBearing, navDistanceM = frame.navDistanceM,
            riderEastM = frame.riderEastM, riderNorthM = frame.riderNorthM,
            courseDeg = frame.courseDeg, routeSpanM = frame.routeSpanM,
            remoteTilt = frame.remoteTilt, tiltControl = PhoneTiltControl.entries.first { it.wire == frame.tiltControl.wire },
            trail = frame.trail, mapPosition = frame.mapPosition,
        ))
        // Only old phones send waiting; retain the fixture's ability to exercise that decoder flag.
        if (frame.waiting) bytes[1] = (bytes[1].toInt() or 2).toByte()
        return bytes
    }

    /** Fixtures start at (0, 0); reject other origins rather than silently shifting the rider. */
    fun route(route: WatchRoute?): ByteArray? {
        val first = route?.points?.firstOrNull() ?: return null
        if (first.eastM != 0f || first.northM != 0f) return null
        return WatchRouteEncoder.encode(route.points.map { point ->
            GeoPoint(lat = point.northM / 110_574.0, lon = point.eastM / 111_320.0)
        })
    }

    fun weather(weather: WatchWeather?): Map<String, Any?>? = weather?.let {
        mapOf(
            WEATHER_TEMP_C to it.temperatureC, WEATHER_ICON to it.icon, WEATHER_LABEL to it.label,
            WEATHER_PRECIP to it.precipitationProbability, WEATHER_FETCHED_AT to it.fetchedAtMs,
            WEATHER_HOUR_MINUTES to it.hourly.map { hour -> hour.minuteOfDay },
            WEATHER_HOUR_TEMPS to it.hourly.map { hour -> hour.temperatureC },
            WEATHER_HOUR_ICONS to it.hourly.map { hour -> hour.icon }.toTypedArray(),
            WEATHER_HOUR_PRECIPS to it.hourly.map { hour -> hour.precipitationProbability },
            WEATHER_SUNRISE to it.sunriseMinuteOfDay, WEATHER_SUNSET to it.sunsetMinuteOfDay,
            WEATHER_LATITUDE to it.latitude, WEATHER_LONGITUDE to it.longitude,
        )
    }
}
