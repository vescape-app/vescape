package expo.modules.vescapecore.alerts

import expo.modules.vescapecore.telemetry.formatValue

import expo.modules.vescapecore.R

import expo.modules.vescapecore.protocol.RefloatTelemetry
import expo.modules.vescapecore.service.VESC_SESSION_TAG
import expo.modules.vescapecore.telemetry.telemetryMetricByControlId

import android.content.Context
import android.media.AudioManager
import android.media.AudioAttributes
import android.media.SoundPool
import android.os.Handler
import android.os.VibrationEffect
import android.os.Vibrator
import android.speech.tts.TextToSpeech
import android.util.Log
import expo.modules.vescapecore.telemetry.AlertRuleEntity
import kotlin.math.abs

private const val TTS_PREFIX = "tts:"

/**
 * Floor on an Alert Rule's repeat cadence, in seconds.
 *
 * @parity /modules/vescape-core/src/index.ts `ALERT_REPEAT_MIN_SECONDS`
 * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `alertRepeatMinSeconds`
 */
const val ALERT_REPEAT_MIN_SECONDS = 3L

/**
 * Inclusive bounds on an Alert Rule's beep count.
 *
 * @parity /modules/vescape-core/src/index.ts `ALERT_BEEP_COUNT_RANGE`
 * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `alertBeepCountRange`
 */
val ALERT_BEEP_COUNT_RANGE = 1..5

/**
 * Beeps per announcement when nothing says otherwise.
 *
 * @parity /modules/vescape-core/src/index.ts `ALERT_BEEP_COUNT_DEFAULT`
 * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `alertBeepCountDefault`
 */
const val ALERT_BEEP_COUNT_DEFAULT = 3

/** Gap between beeps of one announcement — tight enough that a burst reads as a single signal. */
internal const val ALERT_BEEP_SPACING_MS = 350L

/**
 * Clamp a repeat cadence coming from JS. Anything non-positive means one-shot; everything else is
 * floored, so no rule written by any path can announce fast enough to become noise.
 */
fun normalizedAlertRepeatSeconds(raw: Double?): Long? {
    if (raw == null || !raw.isFinite() || raw <= 0.0) return null
    return maxOf(ALERT_REPEAT_MIN_SECONDS, Math.round(raw))
}

/** Clamp a beep count coming from JS; absent or out of range falls back to the default. */
fun normalizedAlertBeepCount(raw: Int?): Int =
    raw?.coerceIn(ALERT_BEEP_COUNT_RANGE.first, ALERT_BEEP_COUNT_RANGE.last) ?: ALERT_BEEP_COUNT_DEFAULT

internal fun alertControlUnit(controlId: String): String =
    telemetryMetricByControlId[controlId]?.unit ?: ""

private fun formatAlertValue(value: Double, controlId: String): String =
    telemetryMetricByControlId[controlId]?.formatValue(value) ?: "%.0f".format(value)

internal fun renderAlertMessageTemplate(
    template: String,
    alert: FiredAlert,
    batteryPercent: Double?,
    onDiagnostic: ((String, Map<String, Any?>) -> Unit)? = null,
): String {
    // @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `renderAlertMessageTemplate`
    val isBattery = alert.controlId == "battery"
    var text = template
    text = text.replace("{value}", formatAlertValue(alert.value, alert.controlId))
    text = text.replace("{threshold}", formatAlertValue(alert.threshold, alert.controlId))
    text = text.replace("{unit}", alertControlUnit(alert.controlId))
    if (isBattery) {
        text = text.replace("{voltage}", formatAlertValue(alert.value, alert.controlId))
        if (batteryPercent != null) {
            text = text.replace("{percent}", "%.0f".format(batteryPercent))
        } else if (text.contains("{percent}")) {
            onDiagnostic?.invoke(
                "alert_template_placeholder_unavailable",
                mapOf("placeholder" to "{percent}", "rule_id" to alert.ruleId, "control_id" to alert.controlId),
            )
            text = text.replace("{percent}", "")
        }
    } else {
        for (ph in listOf("{voltage}", "{percent}")) {
            if (text.contains(ph)) {
                onDiagnostic?.invoke(
                    "alert_template_placeholder_unavailable",
                    mapOf("placeholder" to ph, "rule_id" to alert.ruleId, "control_id" to alert.controlId),
                )
                text = text.replace(ph, "")
            }
        }
    }
    if (text.contains('{')) {
        val unknowns = Regex("\\{[^}]*\\}").findAll(text).map { it.value }.distinct().toList()
        if (unknowns.isNotEmpty()) {
            onDiagnostic?.invoke(
                "alert_template_unknown_placeholder",
                mapOf("placeholders" to unknowns.joinToString(","), "rule_id" to alert.ruleId),
            )
            text = text.replace(Regex("\\{[^}]*\\}"), "")
        }
    }
    return text.trim()
}

private fun ttsSampleAlert(soundType: String) = FiredAlert(
    ruleId = "preview",
    controlId = "battery",
    value = 48.0,
    threshold = 50.0,
    thresholdMax = null,
    soundType = soundType,
    rangeDepth = null,
    beepCount = ALERT_BEEP_COUNT_DEFAULT,
    firedAt = System.currentTimeMillis(),
)

private fun ttsAlarmAttributes(): AudioAttributes = AudioAttributes.Builder()
    .setLegacyStreamType(AudioManager.STREAM_ALARM)
    .setUsage(AudioAttributes.USAGE_ALARM)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()

internal data class FiredAlert(
    val ruleId: String,
    val controlId: String,
    val value: Double,
    val threshold: Double,
    val thresholdMax: Double?,
    val soundType: String,
    val rangeDepth: Double?,
    val beepCount: Int,
    val firedAt: Long,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "ruleId" to ruleId,
        "controlId" to controlId,
        "value" to value,
        "threshold" to threshold,
        "thresholdMax" to thresholdMax,
        "soundType" to soundType,
        "rangeDepth" to rangeDepth,
        "beepCount" to beepCount,
        "firedAt" to firedAt,
    )
}

/**
 * Adds Legal Mode's per-Board speed warning to in-memory rules. No Alert Rule row is materialized.
 * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `withLegalModeOverlay`
 */
internal fun withLegalModeOverlay(
    rules: List<AlertRuleEntity>,
    boardId: String,
    enabled: Boolean,
    warningSpeedKmh: Double?,
    limitSpeedKmh: Double?,
): List<AlertRuleEntity> {
    if (!enabled || warningSpeedKmh == null || limitSpeedKmh == null) return rules
    if (warningSpeedKmh <= 0.0 || limitSpeedKmh <= warningSpeedKmh) return rules

    return rules + AlertRuleEntity(
        boardId = boardId,
        id = "native:legal-mode:speed",
        controlId = "speed",
        threshold = warningSpeedKmh,
        thresholdMax = limitSpeedKmh,
        enabled = true,
        soundType = "preset:tick",
        createdAt = 0L,
        source = null,
        // In-memory overlay: no row is ever persisted, so the sync cursor is meaningless here.
        updatedAt = 0L,
    )
}

/**
 * @param now Wall clock in ms. Injected so repeat cadence is testable without sleeping.
 */
internal class AlertEngine(private val now: () -> Long = { System.currentTimeMillis() }) {
    // @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `AlertEngine`
    private val lastFiredAt = HashMap<String, Long>()
    private val armedState = HashMap<String, Boolean>()

    /** Forget every latch and repeat clock. Called when a new Board Session starts. */
    fun resetAlertState() {
        lastFiredAt.clear()
        armedState.clear()
    }

    fun evaluate(
        rules: List<AlertRuleEntity>,
        t: RefloatTelemetry,
        batteryPercent: Double? = null,
    ): List<FiredAlert> = evaluateRules(rules, batteryPercent) { extractAlertValue(it, t) }

    /**
     * Evaluate already-normalized metric values. Production telemetry and the UI alert test both
     * enter the same stateful arm/re-arm path; callers isolate state by owning separate
     * [AlertEngine] instances.
     *
     * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `evaluateValues`
     */
    fun evaluateValues(
        rules: List<AlertRuleEntity>,
        values: Map<String, Double>,
        batteryPercent: Double? = null,
    ): List<FiredAlert> = evaluateRules(rules, batteryPercent) { values[it] }

    private fun evaluateRules(
        rules: List<AlertRuleEntity>,
        batteryPercent: Double?,
        valueFor: (String) -> Double?,
    ): List<FiredAlert> {
        if (rules.isEmpty()) return emptyList()
        val now = now()
        val fired = mutableListOf<FiredAlert>()

        for (rule in rules) {
            val value = valueFor(rule.controlId) ?: continue
            val compareValue = if (rule.controlId == "battery" && batteryPercent != null) batteryPercent else value
            val aboveDir = alertDirectionIsAbove(rule.controlId)
            val triggered = if (aboveDir) compareValue >= rule.threshold else compareValue <= rule.threshold

            if (isRangeRule(rule, aboveDir)) {
                if (!triggered) continue
                fired.add(rule.toFiredAlert(
                    value = value,
                    rangeDepth = alertRangeDepth(compareValue, rule.threshold, rule.thresholdMax, aboveDir),
                    now = now,
                ))
                continue
            }

            // Single-threshold rule: announce on crossing, then stay latched until the metric
            // travels back past the threshold by this metric's re-arm margin.
            val armed = armedState[rule.id] ?: true
            if (!triggered) {
                if (!armed && hasRearmed(compareValue, rule, aboveDir)) {
                    armedState[rule.id] = true
                    lastFiredAt.remove(rule.id)
                }
                continue
            }
            if (!armed) {
                val repeatMs = (rule.repeatEverySeconds ?: continue) * 1_000L
                if (now - (lastFiredAt[rule.id] ?: 0L) < repeatMs) continue
            }
            armedState[rule.id] = false
            lastFiredAt[rule.id] = now
            fired.add(rule.toFiredAlert(value = value, rangeDepth = null, now = now))
        }

        return coalesceByControl(
            fired.sortedWith(
                compareBy<FiredAlert> { if (it.rangeDepth != null) 0 else 1 }
                    .thenByDescending {
                        if (alertDirectionIsAbove(it.controlId)) it.threshold else -it.threshold
                    }
            )
        )
    }

    /**
     * Keep one single-threshold announcement per metric — the most severe, which the caller has
     * already sorted first. A fast climb crosses several rungs in one evaluation; the rider wants
     * the worst news, not a stutter of speech cut off mid-word. The dropped rules stay latched, so
     * they are spent rather than pending.
     *
     * Range rules pass through untouched: their feedback is a continuous loop keyed by rule id,
     * not an announcement.
     */
    private fun coalesceByControl(sorted: List<FiredAlert>): List<FiredAlert> {
        val announced = HashSet<String>()
        return sorted.filter { alert ->
            alert.rangeDepth != null || announced.add(alert.controlId)
        }
    }

    private fun AlertRuleEntity.toFiredAlert(value: Double, rangeDepth: Double?, now: Long) = FiredAlert(
        ruleId = id,
        controlId = controlId,
        value = value,
        threshold = threshold,
        thresholdMax = thresholdMax,
        soundType = soundType,
        rangeDepth = rangeDepth,
        beepCount = beepCount,
        firedAt = now,
    )

    /** True once a fired rule's metric has travelled back past its threshold by the re-arm margin. */
    private fun hasRearmed(compareValue: Double, rule: AlertRuleEntity, aboveDir: Boolean): Boolean {
        val margin = alertRearmMargin(rule.controlId, rule.threshold)
        return if (aboveDir) compareValue < rule.threshold - margin else compareValue > rule.threshold + margin
    }

    private fun alertRearmMargin(controlId: String, threshold: Double): Double =
        // Controls with no metric definition (footpad) get a relative margin rather than none:
        // zero would let a value dithering on the threshold announce on every telemetry tick.
        telemetryMetricByControlId[controlId]?.alertRearmMargin ?: (abs(threshold) * 0.02)

    private fun isRangeRule(rule: AlertRuleEntity, aboveDir: Boolean): Boolean {
        val max = rule.thresholdMax ?: return false
        return if (aboveDir) max > rule.threshold else max < rule.threshold
    }

    private fun alertDirectionIsAbove(controlId: String): Boolean =
        telemetryMetricByControlId[controlId]?.alertAbove ?: true

    private fun alertRangeDepth(
        value: Double,
        threshold: Double,
        thresholdMax: Double?,
        aboveDir: Boolean,
    ): Double? {
        if (thresholdMax == null || thresholdMax == threshold) return null
        val span = if (aboveDir) thresholdMax - threshold else threshold - thresholdMax
        if (span <= 0.0) return null
        val depth = if (aboveDir) value - threshold else threshold - value
        return (depth / span).coerceIn(0.0, 1.0)
    }

    private fun extractAlertValue(controlId: String, t: RefloatTelemetry): Double? = when (controlId) {
        "speed"           -> abs(t.speed)
        "battery"         -> t.batteryVoltage
        "duty"            -> abs(t.dutyCycle) * 100.0
        "motor-temp"      -> t.tempMotor?.takeIf { it > 0 }
        "motor-current"   -> t.motorCurrent
        "controller-temp" -> t.tempMosfet
        "batt-current"    -> t.batteryCurrent
        "imu"             -> t.pitch
        "footpad"         -> t.adc1
        else              -> null
    }
}

internal data class AlertSoundPreset(
    val name: String,
    val uri: String,
    val category: String,
    val resId: Int,
) {
    fun toMap(): Map<String, Any> = mapOf(
        "name" to name,
        "uri" to uri,
        "category" to category,
    )
}

internal class AlertFeedback(
    private val context: Context,
    private val handler: Handler,
) {
    // @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsPendingText: String? = null
    private var released = false

    private val soundPool = SoundPool.Builder()
        .setMaxStreams(8)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setLegacyStreamType(AudioManager.STREAM_ALARM)
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        )
        .build()
    private val soundIds = HashMap<Int, Int>()
    private val geigerLoops = HashMap<String, GeigerLoop>()
    private val connectSoundId = soundPool.load(context, R.raw.on, 1)
    private val disconnectSoundId = soundPool.load(context, R.raw.off, 1)

    init {
        for (preset in ALERT_SOUND_PRESETS) {
            soundIds[preset.resId] = soundPool.load(context, preset.resId, 1)
        }
    }

    fun playConnect() = playRaw(connectSoundId)

    fun playDisconnect() = playRaw(disconnectSoundId)

    private fun playRaw(soundId: Int) {
        if (released || soundId == 0) return
        try {
            soundPool.play(soundId, 1f, 1f, 1, 0, 1f)
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Connection sound failed: ${e.message}")
        }
    }

    fun speakMessage(text: String) {
        if (released) return
        val existing = tts
        if (existing == null) {
            ttsPendingText = text
            tts = TextToSpeech(context) { status ->
                if (released) {
                    tts?.shutdown()
                    tts = null
                    return@TextToSpeech
                }
                if (status == TextToSpeech.SUCCESS) {
                    tts?.setAudioAttributes(ttsAlarmAttributes())
                    ttsReady = true
                    val pending = ttsPendingText
                    ttsPendingText = null
                    if (pending != null) speakNow(pending)
                } else {
                    Log.w(VESC_SESSION_TAG, "TTS init failed status=$status")
                }
            }
            return
        }
        if (!ttsReady) {
            ttsPendingText = text
            return
        }
        speakNow(text)
    }

    private fun speakNow(text: String) {
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "vesc_alert")
    }

    /** Play one announcement: [beepCount] plays of the rule's sound, [ALERT_BEEP_SPACING_MS] apart. */
    fun playSingle(soundType: String, beepCount: Int = ALERT_BEEP_COUNT_DEFAULT) {
        try {
            val preset = resolveAlertPreset(soundType, ALERT_CATEGORY_SINGLE)
            val beeps = normalizedAlertBeepCount(beepCount)
            playPreset(preset)
            for (index in 1 until beeps) {
                handler.postDelayed({ playPreset(preset) }, index * ALERT_BEEP_SPACING_MS)
            }
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Alert sound failed: ${e.message}")
        }
    }

    fun preview(soundType: String) {
        if (soundType.startsWith(TTS_PREFIX)) {
            val template = soundType.removePrefix(TTS_PREFIX)
            val text = renderAlertMessageTemplate(template, ttsSampleAlert(soundType), batteryPercent = 42.0)
            if (text.isNotEmpty()) speakMessage(text)
            return
        }
        try {
            playPreset(resolveAlertPreset(soundType, null))
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Alert preview failed: ${e.message}")
        }
    }

    fun updateGeiger(ruleId: String, soundType: String, rangeDepth: Double) {
        if (released) return
        try {
            val depth = rangeDepth.coerceIn(0.0, 1.0)
            val existing = geigerLoops[ruleId]
            val tickPreset = resolveAlertPreset(soundType, ALERT_CATEGORY_GEIGER)
            if (depth >= 1.0) {
                existing?.runnable?.let { handler.removeCallbacks(it) }
                if (existing?.sustained == true) return
                existing?.streamId?.let { soundPool.stop(it) }
                val streamId = playPreset(tickPreset, loop = -1)
                geigerLoops[ruleId] = GeigerLoop(soundType, depth, sustained = true, streamId = streamId)
                return
            }

            if (existing?.sustained == true) {
                existing.streamId?.let { soundPool.stop(it) }
            }
            if (existing != null && !existing.sustained && existing.soundType == soundType) {
                existing.rangeDepth = depth
                return
            }
            existing?.runnable?.let { handler.removeCallbacks(it) }
            val loop = GeigerLoop(soundType, depth, sustained = false)
            val runnable = object : Runnable {
                override fun run() {
                    playPreset(tickPreset)
                    handler.postDelayed(this, geigerIntervalMs(loop.rangeDepth))
                }
            }
            loop.runnable = runnable
            geigerLoops[ruleId] = loop
            handler.post(runnable)
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Geiger sound failed: ${e.message}")
        }
    }

    fun stopGeiger(ruleId: String) {
        val loop = geigerLoops.remove(ruleId) ?: return
        loop.runnable?.let { handler.removeCallbacks(it) }
        loop.streamId?.let { soundPool.stop(it) }
    }

    fun stopAllGeiger() {
        for (ruleId in geigerLoops.keys.toList()) stopGeiger(ruleId)
    }

    fun release() {
        if (released) return
        released = true
        stopAllGeiger()
        soundPool.release()
        tts?.stop()
        tts?.shutdown()
        tts = null
        ttsReady = false
    }

    fun vibrate(rangeDepth: Double?) {
        if (released) return
        try {
            val v = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
            if (rangeDepth != null) {
                val durationMs = (90L + (260L * rangeDepth)).toLong()
                v.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
                return
            }
            v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 450, 120, 450, 120, 650), -1))
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Vibrate failed: ${e.message}")
        }
    }

    private fun playPreset(preset: AlertSoundPreset, loop: Int = 0): Int {
        if (released) return 0
        val soundId = soundIds[preset.resId] ?: return 0
        return soundPool.play(soundId, 1f, 1f, 1, loop, 1f)
    }

    private fun geigerIntervalMs(rangeDepth: Double): Long =
        (800L - (740L * rangeDepth.coerceIn(0.0, 1.0))).toLong().coerceIn(60L, 800L)

    private data class GeigerLoop(
        val soundType: String,
        var rangeDepth: Double,
        val sustained: Boolean,
        val streamId: Int? = null,
        var runnable: Runnable? = null,
    )

    companion object {
        fun preview(context: Context, soundType: String) {
            if (soundType.startsWith(TTS_PREFIX)) {
                val template = soundType.removePrefix(TTS_PREFIX)
                val text = renderAlertMessageTemplate(template, ttsSampleAlert(soundType), batteryPercent = 42.0)
                if (text.isEmpty()) return
                val handler = Handler(contextMainLooper())
                val holder = arrayOfNulls<TextToSpeech>(1)
                holder[0] = TextToSpeech(context) { status ->
                    if (status == TextToSpeech.SUCCESS) {
                        val t = holder[0] ?: return@TextToSpeech
                        t.setAudioAttributes(ttsAlarmAttributes())
                        t.speak(text, TextToSpeech.QUEUE_FLUSH, null, "preview")
                        handler.postDelayed({ t.stop(); t.shutdown() }, 5_000)
                    }
                }
                return
            }
            val handler = Handler(contextMainLooper())
            val preset = resolveAlertPreset(soundType, null)
            val pool = SoundPool.Builder()
                .setMaxStreams(2)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setLegacyStreamType(AudioManager.STREAM_ALARM)
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                .build()
            try {
                pool.setOnLoadCompleteListener { soundPool, sampleId, status ->
                    if (status == 0) soundPool.play(sampleId, 1f, 1f, 1, 0, 1f)
                }
                pool.load(context, preset.resId, 1)
                handler.postDelayed({ pool.release() }, 1_000)
            } catch (e: Exception) {
                pool.release()
                Log.w(VESC_SESSION_TAG, "Alert preview failed: ${e.message}")
            }
        }

        private fun contextMainLooper() = android.os.Looper.getMainLooper()
    }
}

internal fun alertSoundPresetMaps(): List<Map<String, Any>> =
    ALERT_SOUND_PRESETS
        .filter { it.uri != "preset:sustained" }
        .map { it.toMap() }

// @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `alertCategorySingle`
// @parity /modules/vescape-core/src/index.ts `AlertSoundCategory`
private const val ALERT_CATEGORY_SINGLE = "single"

// @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `alertCategoryGeiger`
// @parity /modules/vescape-core/src/index.ts `AlertSoundCategory`
private const val ALERT_CATEGORY_GEIGER = "geiger"

private val ALERT_SOUND_PRESETS = listOf(
    AlertSoundPreset("Beep", "preset:beep", ALERT_CATEGORY_SINGLE, R.raw.alert_beep),
    AlertSoundPreset("Urgent", "preset:urgent", ALERT_CATEGORY_SINGLE, R.raw.alert_urgent),
    AlertSoundPreset("Notify", "preset:notify", ALERT_CATEGORY_SINGLE, R.raw.alert_notify),
    AlertSoundPreset("Tick", "preset:tick", ALERT_CATEGORY_GEIGER, R.raw.alert_tick),
    AlertSoundPreset("Hard Tick", "preset:tick_hard", ALERT_CATEGORY_GEIGER, R.raw.alert_tick_hard),
    AlertSoundPreset("Gamma", "preset:gamma", ALERT_CATEGORY_GEIGER, R.raw.alert_gamma),
    AlertSoundPreset("Sustained", "preset:sustained", ALERT_CATEGORY_GEIGER, R.raw.alert_sustained),
)

private fun resolveAlertPreset(soundType: String, category: String?): AlertSoundPreset {
    val key = when {
        soundType.startsWith("preset:") -> soundType.removePrefix("preset:")
        soundType.contains(":") -> null
        soundType == "default" -> "beep"
        soundType == "pulse" -> "notify"
        else -> soundType
    }
    val uri = key?.let { "preset:$it" }
    val preset = ALERT_SOUND_PRESETS.firstOrNull { it.uri == uri }
    if (preset != null && (category == null || preset.category == category)) return preset
    return when (category) {
        ALERT_CATEGORY_GEIGER -> ALERT_SOUND_PRESETS.first { it.uri == "preset:tick" }
        else -> ALERT_SOUND_PRESETS.first { it.uri == "preset:beep" }
    }
}
