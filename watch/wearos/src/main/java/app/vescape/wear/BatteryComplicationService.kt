package app.vescape.wear

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Intent
import androidx.compose.ui.graphics.toArgb
import android.graphics.drawable.Icon
import android.net.Uri
import androidx.wear.watchface.complications.data.*
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Reads the Data Layer directly, including while MainActivity has never been opened. */
class BatteryComplicationService : SuspendingComplicationDataSourceService() {
    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData = withContext(Dispatchers.IO) {
        val items = Tasks.await(Wearable.getDataClient(this@BatteryComplicationService).getDataItems(
            Uri.parse("wear://*$LAST_BATTERY_PATH"), DataClient.FILTER_LITERAL,
        ))
        try {
            val battery = items.firstOrNull()?.let { decodeLastBatteryItem(it) }
            batteryComplicationData(battery, request.complicationType, System.currentTimeMillis(), tapAction(), packageName)
        } finally { items.release() }
    }
    override fun getPreviewData(type: ComplicationType): ComplicationData = batteryComplicationData(
        WatchLastBattery("preview", "X7", 78.0, System.currentTimeMillis()), type, System.currentTimeMillis(), null, packageName,
    )
    private fun tapAction() = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
}

internal fun decodeLastBatteryItem(item: DataItem): WatchLastBattery? {
    val map = DataMapItem.fromDataItem(item).dataMap
    return WatchLastBattery.decode(map.keySet().associateWith { map.get<Any>(it) })
}

/**
 * The watch face owns typography and placement; these are its production data fields.
 * @parity /watch/watchos/BatteryComplicationView.swift
 * @platform-diff A never-seen Board is No Data, the watch face's own empty state; watchOS shows
 *   the Board name with `--`.
 */
internal fun batteryComplicationData(battery: WatchLastBattery?, type: ComplicationType, now: Long, tap: PendingIntent?, packageName: String): ComplicationData {
    if (battery?.percent == null) return NoDataComplicationData()
    val percent = PlainComplicationText.Builder(battery.text).build()
    val full = listOfNotNull(battery.boardName, battery.text, battery.ageLabel(now)).joinToString(" · ")
    val description = PlainComplicationText.Builder(full).build()
    val icon = MonochromaticImage.Builder(Icon.createWithResource(packageName, R.drawable.ic_battery_complication)).build()
    return when (type) {
        ComplicationType.RANGED_VALUE -> RangedValueComplicationData.Builder(battery.percent.toFloat(), 0f, 100f, description)
            .setText(percent).setMonochromaticImage(icon).setTapAction(tap)
            .setColorRamp(ColorRamp(intArrayOf(batteryColor(battery.percent).toArgb()), false)).build()
        ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(percent, description)
            .setMonochromaticImage(icon).setTapAction(tap).build()
        ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(description, description)
            .setMonochromaticImage(icon).setTapAction(tap).build()
        else -> NoDataComplicationData()
    }
}

/** Closed-app receive path. The Data Layer item itself is the only durable battery store. */
class BatteryComplicationListener : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.dataItem.uri.path != LAST_BATTERY_PATH) continue
            val value = if (event.type == DataEvent.TYPE_DELETED) null else decodeLastBatteryItem(event.dataItem)
            if (gate.changed(value, System.currentTimeMillis())) {
                ComplicationDataSourceUpdateRequester.create(this, ComponentName(this, BatteryComplicationService::class.java)).requestUpdateAll()
            }
        }
    }
    companion object { private val gate = BatteryUpdateGate() }
}
