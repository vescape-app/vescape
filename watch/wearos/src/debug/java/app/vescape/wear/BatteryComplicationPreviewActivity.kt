package app.vescape.wear

import android.app.Activity
import android.os.Bundle
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.content.Context
import android.view.View
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.rendering.ComplicationDrawable
import java.time.Instant

/** DEBUG APK only. Renders production provider data through AndroidX's complication renderer. */
class BatteryComplicationPreviewActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(Preview(this, intent.getStringExtra("state") ?: "healthy"))
    }
    private class Preview(context: Context, private val state: String) : View(context) {
        private val now = System.currentTimeMillis()
        private val battery = if (state == "unknown") null else WatchLastBattery("fixture", "X7", if (state == "warning") 15.0 else 78.0, now - if (state == "stale") 7_200_000 else 0)
        private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.LTGRAY; textAlign = Paint.Align.CENTER }
        private val complications = listOf(ComplicationType.RANGED_VALUE, ComplicationType.SHORT_TEXT, ComplicationType.LONG_TEXT).map { type ->
            ComplicationDrawable(context).apply {
                setComplicationData(batteryComplicationData(battery, type, now, null, context.packageName), false)
                currentTime = Instant.ofEpochMilli(now)
                activeStyle.textColor = Color.WHITE
                activeStyle.titleColor = Color.LTGRAY
                activeStyle.iconColor = Color.WHITE
                activeStyle.rangedValuePrimaryColor = if (this@Preview.state == "warning") Color.rgb(249, 115, 22) else Color.rgb(34, 197, 94)
                activeStyle.rangedValueSecondaryColor = Color.DKGRAY
            }
        }
        override fun onDraw(canvas: Canvas) {
            canvas.drawColor(Color.BLACK)
            label.textSize = width * .035f
            canvas.drawText("DEBUG · $state", width / 2f, height * .18f, label)
            val side = (width * .27f).toInt()
            complications[0].setBounds((width * .19).toInt(), (height * .26).toInt(), (width * .19).toInt() + side, (height * .26).toInt() + side)
            complications[1].setBounds((width * .54).toInt(), (height * .26).toInt(), (width * .54).toInt() + side, (height * .26).toInt() + side)
            complications[2].setBounds((width * .14).toInt(), (height * .61).toInt(), (width * .86).toInt(), (height * .77).toInt())
            complications.forEach { it.draw(canvas) }
            canvas.drawText("Ranged · Short · Long", width / 2f, height * .85f, label)
        }
    }
}
