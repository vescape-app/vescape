package expo.modules.vescapecore.alerts

import expo.modules.vescapecore.telemetry.formatValue
import expo.modules.vescapecore.telemetry.UnitPresentation
import expo.modules.vescapecore.telemetry.AppDataRepository

import expo.modules.vescapecore.protocol.RefloatTelemetry
import expo.modules.vescapecore.diagnostics.UnexpectedNativeError
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

/**
 * Floor on an Alert Rule's repeat cadence, in seconds.
 *
 * @parity /modules/vescape-core/src/index.ts `ALERT_REPEAT_MIN_SECONDS`
 * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `alertRepeatMinSeconds`
 */
const val ALERT_REPEAT_MIN_SECONDS = 3L

/**
 * Inclusive bounds on the count of an `alert(count):severity` sound.
 *
 * @parity /modules/vescape-core/src/index.ts `ALERT_BEEP_COUNT_RANGE`
 * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `alertBeepCountRange`
 */
val ALERT_BEEP_COUNT_RANGE = 1..5

/**
 * Gap between beeps of one announcement — tight enough that a burst reads as a single signal. A
 * sound longer than this (a pack's multi-beep severity) repeats once it ends, this far apart.
 */
internal const val ALERT_BEEP_SPACING_MS = 350L

/**
 * Clamp a repeat cadence coming from JS. Anything non-positive means one-shot; everything else is
 * floored, so no rule written by any path can announce fast enough to become noise.
 */
fun normalizedAlertRepeatSeconds(raw: Double?): Long? {
    if (raw == null || !raw.isFinite() || raw <= 0.0) return null
    return maxOf(ALERT_REPEAT_MIN_SECONDS, Math.round(raw))
}

/**
 * Earliest speech start after the severity sound starts. A longer sound (a multi-beep pack
 * severity) delays speech to its end, so the two never overlap.
 *
 * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `alertSpeechDelayMs`
 */
internal const val ALERT_SPEECH_DELAY_MS = 350L

/** When speech may start after [severity]'s sound in [pack] starts playing. */
internal fun speechDelayMs(context: Context, pack: String, severity: AlertSeverity): Long =
    maxOf(ALERT_SPEECH_DELAY_MS, EffectsPackAssets.durationMs(context, pack, severity.slot))

internal fun alertControlUnit(controlId: String): String =
    telemetryMetricByControlId[controlId]?.unit ?: ""

private fun formatAlertValue(value: Double, controlId: String): String =
    telemetryMetricByControlId[controlId]?.formatValue(value) ?: "%.0f".format(value)

internal fun renderAlertMessageTemplate(
    template: String,
    alert: FiredAlert,
    batteryPercent: Double?,
    onDiagnostic: ((String, Map<String, Any?>) -> Unit)? = null,
    unitSystem: String = "metric",
): String {
    // @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `renderAlertMessageTemplate`
    val isBattery = alert.controlId == "battery"
    fun format(value: Double) = if (alert.controlId == "speed") UnitPresentation.formatSpokenSpeed(value, unitSystem) else formatAlertValue(value, alert.controlId)
    var text = template
    text = text.replace("{value}", format(alert.value))
    text = text.replace("{threshold}", format(alert.threshold))
    text = text.replace("{unit}", if (alert.controlId == "speed") UnitPresentation.speedUnit(unitSystem) else alertControlUnit(alert.controlId))
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
    firedAt = System.currentTimeMillis(),
)

internal fun audioAttributes(source: String, contentType: Int): AudioAttributes = AudioAttributes.Builder()
    .setLegacyStreamType(if (source == "media") AudioManager.STREAM_MUSIC else AudioManager.STREAM_ALARM)
    .setUsage(if (source == "media") AudioAttributes.USAGE_MEDIA else AudioAttributes.USAGE_ALARM)
    .setContentType(contentType)
    .build()

internal data class FiredAlert(
    val ruleId: String,
    val controlId: String,
    val value: Double,
    val threshold: Double,
    val thresholdMax: Double?,
    val soundType: String,
    val rangeDepth: Double?,
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
        soundType = "geiger:soft",
        createdAt = 0L,
        source = null,
    )
}

/**
 * @param now Wall clock in ms. Injected so repeat cadence is testable without sleeping.
 */
internal class AlertEngine(private val now: () -> Long = { System.currentTimeMillis() }) {
    // @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `AlertEngine`
    private val lastFiredAt = HashMap<String, Long>()
    private val armedState = HashMap<String, Boolean>()
    private var configValues: Map<String, Any> = emptyMap()
    private var motorConfigValues: Map<String, Any> = emptyMap()

    fun updateBoardConfigValues(values: Map<String, Any>) { configValues = values }

    /** VESC motor config (MCCONF), the other half of what a config-relative rule may anchor to. */
    fun updateMotorConfigValues(values: Map<String, Any>) { motorConfigValues = values }

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
            val effective = effectiveThresholds(rule) ?: continue
            val value = valueFor(rule.controlId) ?: continue
            val compareValue = if (rule.controlId == "battery" && batteryPercent != null) batteryPercent else value
            val aboveDir = alertDirectionIsAbove(rule.controlId)
            val triggered = if (aboveDir) compareValue >= effective.first else compareValue <= effective.first

            if (effective.second != null && if (aboveDir) effective.second!! > effective.first else effective.second!! < effective.first) {
                if (!triggered) continue
                fired.add(rule.toFiredAlert(
                    value = value,
                    rangeDepth = alertRangeDepth(compareValue, effective.first, effective.second, aboveDir),
                    now = now,
                    effective = effective,
                ))
                continue
            }

            // Single-threshold rule: announce on crossing, then stay latched until the metric
            // travels back past the threshold by this metric's re-arm margin.
            val armed = armedState[rule.id] ?: true
            if (!triggered) {
                if (!armed && hasRearmed(compareValue, rule, effective.first, aboveDir)) {
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
            fired.add(rule.toFiredAlert(value = value, rangeDepth = null, now = now, effective = effective))
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

    private fun AlertRuleEntity.toFiredAlert(value: Double, rangeDepth: Double?, now: Long, effective: Pair<Double, Double?> = threshold to thresholdMax) = FiredAlert(
        ruleId = id,
        controlId = controlId,
        value = value,
        threshold = effective.first,
        thresholdMax = effective.second,
        soundType = soundType,
        rangeDepth = rangeDepth,
        firedAt = now,
    )

    // @parity /src/modules/alerts/lib/resolvedAlertRules.ts `resolvedAlertRules`
    private fun effectiveThresholds(rule: AlertRuleEntity): Pair<Double, Double?>? {
        if (rule.thresholdKind != "config-relative") return rule.threshold to rule.thresholdMax
        val base = resolveConfigRelativeBase(rule.configFieldId, configValues, motorConfigValues) ?: return null
        return (base + (rule.thresholdOffset ?: return null)) to rule.thresholdMaxOffset?.let { base + it }
    }

    /**
     * True once a fired rule's metric has travelled back past its effective threshold by the re-arm margin.
     * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `hasRearmed`
     */
    private fun hasRearmed(compareValue: Double, rule: AlertRuleEntity, effectiveThreshold: Double, aboveDir: Boolean): Boolean {
        val margin = alertRearmMargin(rule.controlId, effectiveThreshold)
        return if (aboveDir) compareValue < effectiveThreshold - margin else compareValue > effectiveThreshold + margin
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

internal class AlertFeedback(
    private val context: Context,
    private val handler: Handler,
) {
    // @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift
    // @platform-diff Android selects alarm/media streams; iOS retains its playback session.
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsPendingText: String? = null
    private var released = false

    private var audioSource = "alarm"
    private fun newSoundPool() = SoundPool.Builder().setMaxStreams(8)
        .setAudioAttributes(audioAttributes(audioSource, AudioAttributes.CONTENT_TYPE_SONIFICATION)).build()
    private var soundPool = newSoundPool()
    /** SoundPool sample per `"<pack>/<slot>"` of every built-in effects pack. */
    private val soundIds = HashMap<String, Int>()
    private val geigerLoops = HashMap<String, GeigerLoop>()
    private val samples = SoundSampleQueue()
    private val pendingGeiger = HashMap<String, Pair<String, Double>>()
    var soundPack: String = "retro"

    fun setSoundSettings(pack: String, source: String) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { setSoundSettings(pack, source) }
            return
        }
        if (released) return
        soundPack = pack
        setAudioSource(source)
    }

    init { loadAssets() }

    private fun loadAssets() {
        soundIds.clear()
        samples.reset()
        soundPool.setOnLoadCompleteListener { pool, sampleId, status ->
            handler.post {
                if (pool !== soundPool || released) return@post
                if (status != 0) {
                    UnexpectedNativeError.report("alert_audio_asset_load", "bundled_asset", IllegalStateException("sample $sampleId status $status"))
                }
                samples.complete(sampleId, status == 0)
                val loops = pendingGeiger.toMap()
                pendingGeiger.clear()
                for ((id, request) in loops) updateGeiger(id, request.first, request.second)
            }
        }
        try {
            for ((key, path) in EffectsPackAssets.slots(context)) {
                soundIds[key] = context.assets.openFd(path).use { soundPool.load(it, 1) }
            }
        } catch (e: Exception) {
            UnexpectedNativeError.report("alert_audio_asset_load", "bundled_asset", e)
        }
    }

    /** Sample of [slot] in the active effects pack; 0 when it never loaded. */
    private fun slotSample(slot: String, pack: String = soundPack): Int =
        soundIds["${effectsPackId(pack)}/$slot"] ?: 0

    fun setAudioSource(source: String) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { setAudioSource(source) }
            return
        }
        val selected = if (source == "media") "media" else "alarm"
        if (released || audioSource == selected) return
        val loops = geigerLoops.mapValues { (_, loop) -> loop.soundType to loop.rangeDepth } + pendingGeiger
        val waitingPlays = samples.takePending()
        stopAllGeiger()
        soundPool.release()
        audioSource = selected
        soundPool = newSoundPool()
        pendingGeiger.clear()
        pendingGeiger.putAll(loops)
        loadAssets()
        waitingPlays.forEach { it() }
        tts?.stop()
        tts?.setAudioAttributes(audioAttributes(audioSource, AudioAttributes.CONTENT_TYPE_SPEECH))
    }

    fun playConnect() {
        if (android.os.Looper.myLooper() != handler.looper) { handler.post { playConnect() }; return }
        playAppSound(soundPack, "on")
    }

    fun playDisconnect() {
        if (android.os.Looper.myLooper() != handler.looper) { handler.post { playDisconnect() }; return }
        playAppSound(soundPack, "off")
    }

    fun playAppSound(pack: String, cue: String) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { playAppSound(pack, cue) }
            return
        }
        if (released) return
        if (CustomAppSounds.play(context, pack, cue, audioSource, { playAppSound(EFFECTS_PACK_FALLBACK, cue) }, this)) return
        val sample = slotSample(appCueSlot(cue) ?: return, pack)
        when (samples.state(sample)) {
            SoundSampleQueue.State.READY -> playRaw(sample)
            SoundSampleQueue.State.PENDING -> samples.enqueue(sample) { playAppSound(pack, cue) }
            SoundSampleQueue.State.FAILED -> Unit
        }
    }

    private fun playRaw(soundId: Int) {
        if (released) return
        if (soundId == 0) {
            UnexpectedNativeError.report("alert_audio_connection_asset", "bundled_asset", IllegalStateException())
            return
        }
        try {
            check(soundPool.play(soundId, 1f, 1f, 1, 0, 1f) != 0) { "SoundPool refused playback" }
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Connection sound failed: ${e.message}")
            UnexpectedNativeError.report("alert_audio_connection_play", "audio_play_failed", e)
        }
    }

    fun speakMessage(text: String) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { speakMessage(text) }
            return
        }
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
                    tts?.setAudioAttributes(audioAttributes(audioSource, AudioAttributes.CONTENT_TYPE_SPEECH))
                    ttsReady = true
                    val pending = ttsPendingText
                    ttsPendingText = null
                    if (pending != null) speakNow(pending)
                } else {
                    Log.w(VESC_SESSION_TAG, "TTS init failed status=$status")
                    UnexpectedNativeError.report("alert_audio_tts_init", "audio_start_failed", IllegalStateException("TTS status $status"))
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

    /** Play when the Board Session ride ends. */
    fun playRideEnd() {
        if (android.os.Looper.myLooper() != handler.looper) { handler.post { playRideEnd() }; return }
        playAppSound(soundPack, "ride.end")
    }

    /**
     * Play one announcement: an `alert(count):severity` rule's severity sound from the active effects
     * pack, [count][SlotAlertSound.count] times, [ALERT_BEEP_SPACING_MS] apart.
     */
    fun playSingle(soundType: String) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { playSingle(soundType) }
            return
        }
        playSeverity(parseSlotAlertSound(soundType))
    }

    private fun playSeverity(sound: SlotAlertSound) {
        try {
            val slot = sound.severity.slot
            val duration = EffectsPackAssets.durationMs(context, soundPack, slot)
            val interval = if (duration > ALERT_BEEP_SPACING_MS) duration + ALERT_BEEP_SPACING_MS else ALERT_BEEP_SPACING_MS
            playSlot(slot)
            for (index in 1 until sound.count) {
                handler.postDelayed({ playSlot(slot) }, index * interval)
            }
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Alert sound failed: ${e.message}")
            UnexpectedNativeError.report("alert_audio_single_play", "audio_play_failed", e)
        }
    }

    /**
     * Speak a TTS rule's [text] after its [severity] sound, played once; speech starts once the sound
     * has finished, so the two never overlap.
     *
     * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `speakAfterSeverity`
     */
    fun speakAfterSeverity(severity: AlertSeverity, text: String) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { speakAfterSeverity(severity, text) }
            return
        }
        // A newer announcement supersedes speech still waiting out an older one's sound.
        pendingSpeech?.let { handler.removeCallbacks(it) }
        playSeverity(SlotAlertSound(1, severity))
        val speech = Runnable { pendingSpeech = null; speakMessage(text) }
        pendingSpeech = speech
        handler.postDelayed(speech, speechDelayMs(context, soundPack, severity))
    }

    private var pendingSpeech: Runnable? = null

    fun preview(soundType: String) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { preview(soundType) }
            return
        }
        val tts = parseTtsAlertSound(soundType)
        if (tts != null) {
            val text = renderAlertMessageTemplate(tts.text, ttsSampleAlert(soundType), batteryPercent = 42.0, unitSystem = kotlinx.coroutines.runBlocking { AppDataRepository.get(context).getTypedSettings().unitSystem })
            if (text.isNotEmpty()) speakAfterSeverity(tts.severity, text)
            return
        }
        try {
            playSlot(previewSlot(soundType))
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Alert preview failed: ${e.message}")
            UnexpectedNativeError.report("alert_audio_preview", "audio_play_failed", e)
        }
    }

    fun updateGeiger(ruleId: String, soundType: String, rangeDepth: Double) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { updateGeiger(ruleId, soundType, rangeDepth) }
            return
        }
        if (released) return
        val tickSlot = geigerSlot(soundType)
        val sample = slotSample(tickSlot)
        if (samples.state(sample) == SoundSampleQueue.State.FAILED) { stopGeiger(ruleId); return }
        if (samples.state(sample) == SoundSampleQueue.State.PENDING) {
            pendingGeiger[ruleId] = soundType to rangeDepth
            return
        }
        try {
            val depth = rangeDepth.coerceIn(0.0, 1.0)
            val existing = geigerLoops[ruleId]
            if (depth >= 1.0) {
                existing?.runnable?.let { handler.removeCallbacks(it) }
                if (existing?.sustained == true) return
                existing?.streamId?.let { soundPool.stop(it) }
                val streamId = playSlot(tickSlot, loop = -1)
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
                    if (released || geigerLoops[ruleId] !== loop) return
                    playSlot(tickSlot)
                    handler.postDelayed(this, geigerIntervalMs(loop.rangeDepth))
                }
            }
            loop.runnable = runnable
            geigerLoops[ruleId] = loop
            handler.post(runnable)
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Geiger sound failed: ${e.message}")
            UnexpectedNativeError.report("alert_audio_geiger_play", "audio_play_failed", e)
        }
    }

    fun stopGeiger(ruleId: String) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { stopGeiger(ruleId) }
            return
        }
        pendingGeiger.remove(ruleId)
        val loop = geigerLoops.remove(ruleId) ?: return
        loop.runnable?.let { handler.removeCallbacks(it) }
        loop.streamId?.let { soundPool.stop(it) }
    }

    fun stopAllGeiger() {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { stopAllGeiger() }
            return
        }
        pendingGeiger.clear()
        for (ruleId in geigerLoops.keys.toList()) stopGeiger(ruleId)
    }

    fun release() {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { release() }
            return
        }
        if (released) return
        released = true
        stopAllGeiger()
        samples.reset()
        CustomAppSounds.releasePlayers(this)
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

    private fun playSlot(slot: String, loop: Int = 0): Int {
        if (released) return 0
        val soundId = slotSample(slot)
        if (soundId == 0 || samples.state(soundId) == SoundSampleQueue.State.FAILED) return 0
        if (samples.state(soundId) == SoundSampleQueue.State.PENDING) {
            samples.enqueue(soundId) { playSlot(slot, loop) }
            return 0
        }
        return soundPool.play(soundId, 1f, 1f, 1, loop, 1f)
          .also { check(it != 0) { "SoundPool refused playback" } }
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
        /** Preview without requiring a running board session. */
        fun previewAppSound(context: Context, pack: String, cue: String, source: String) {
            if (CustomAppSounds.play(context, pack, cue, source, {
                previewAppSound(context, EFFECTS_PACK_FALLBACK, cue, source)
            })) return
            val path = EffectsPackAssets.path(context, pack, appCueSlot(cue) ?: return) ?: return
            val pool = SoundPool.Builder().setMaxStreams(1).setAudioAttributes(
                audioAttributes(source, AudioAttributes.CONTENT_TYPE_SONIFICATION)
            ).build()
            pool.setOnLoadCompleteListener { soundPool, sampleId, status ->
                if (status == 0) soundPool.play(sampleId, 1f, 1f, 1, 0, 1f)
            }
            context.assets.openFd(path).use { pool.load(it, 1) }
            Handler(contextMainLooper()).postDelayed({ pool.release() }, 5_000)
        }

        fun preview(context: Context, soundType: String, source: String) {
            val handler = Handler(contextMainLooper())
            val settings = kotlinx.coroutines.runBlocking { AppDataRepository.get(context).getTypedSettings() }
            fun slotPath(slot: String) = EffectsPackAssets.path(context, settings.soundPack, slot)
            val tts = parseTtsAlertSound(soundType)
            if (tts != null) {
                val text = renderAlertMessageTemplate(tts.text, ttsSampleAlert(soundType), batteryPercent = 42.0, unitSystem = settings.unitSystem)
                if (text.isEmpty()) return
                // Speech waits for both the engine and the severity sound, whichever is later. Both
                // callbacks land on the main looper, so the flags need no locking.
                var ready: TextToSpeech? = null
                var soundDone = false
                fun speakWhenReady() {
                    val t = ready ?: return
                    if (!soundDone) return
                    ready = null
                    t.speak(text, TextToSpeech.QUEUE_FLUSH, null, "preview")
                    handler.postDelayed({ t.stop(); t.shutdown() }, 5_000)
                }
                previewClip(context, handler, slotPath(tts.severity.slot), source, speechDelayMs(context, settings.soundPack, tts.severity)) {
                    soundDone = true
                    speakWhenReady()
                }
                val holder = arrayOfNulls<TextToSpeech>(1)
                holder[0] = TextToSpeech(context) { status ->
                    if (status == TextToSpeech.SUCCESS) {
                        val t = holder[0] ?: return@TextToSpeech
                        t.setAudioAttributes(audioAttributes(source, AudioAttributes.CONTENT_TYPE_SPEECH))
                        handler.post { ready = t; speakWhenReady() }
                    }
                }
                return
            }
            previewClip(context, handler, slotPath(previewSlot(soundType)), source)
        }

        /**
         * Play the pack clip at asset [path] once on a throwaway pool. [onDone] runs once it has
         * finished, or right away if the sample fails to load.
         */
        private fun previewClip(context: Context, handler: Handler, path: String?, source: String, doneAfterMs: Long = 0L, onDone: (() -> Unit)? = null) {
            if (path == null) {
                UnexpectedNativeError.report("alert_audio_preview_load", "bundled_asset", IllegalStateException())
                onDone?.let { handler.post(it) }
                return
            }
            val pool = SoundPool.Builder()
                .setMaxStreams(2)
                .setAudioAttributes(
                    audioAttributes(source, AudioAttributes.CONTENT_TYPE_SONIFICATION)
                )
                .build()
            try {
                pool.setOnLoadCompleteListener { soundPool, sampleId, status ->
                    if (status == 0) {
                        soundPool.play(sampleId, 1f, 1f, 1, 0, 1f)
                        onDone?.let { handler.postDelayed(it, doneAfterMs) }
                    } else {
                        UnexpectedNativeError.report("alert_audio_preview_load", "bundled_asset", IllegalStateException())
                        onDone?.let { handler.post(it) }
                    }
                }
                context.assets.openFd(path).use { pool.load(it, 1) }
                // Outlive the whole clip (HEV critical runs past a second) plus load time.
                handler.postDelayed({ pool.release() }, EffectsPackAssets.durationMs(context, path) + 1_000)
            } catch (e: Exception) {
                pool.release()
                onDone?.let { handler.post(it) }
                Log.w(VESC_SESSION_TAG, "Alert preview failed: ${e.message}")
                UnexpectedNativeError.report("alert_audio_preview", "audio_play_failed", e)
            }
        }

        private fun contextMainLooper() = android.os.Looper.getMainLooper()
    }
}

/**
 * Sounds the alert form offers: the active effects pack's severities for single alerts, geiger ticks
 * for range alerts.
 *
 * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `alertSoundChoices`
 * @parity /modules/vescape-core/src/index.ts `FALLBACK_SOUNDS`
 */
internal fun alertSoundMaps(): List<Map<String, Any>> = listOf(
    Triple("Info", "alert:info", ALERT_CATEGORY_SINGLE),
    Triple("Warning", "alert:warning", ALERT_CATEGORY_SINGLE),
    Triple("Critical", "alert:critical", ALERT_CATEGORY_SINGLE),
    Triple("Soft", "geiger:soft", ALERT_CATEGORY_GEIGER),
    Triple("Mid", "geiger:mid", ALERT_CATEGORY_GEIGER),
    Triple("Hard", "geiger:hard", ALERT_CATEGORY_GEIGER),
).map { (name, uri, category) -> mapOf("name" to name, "uri" to uri, "category" to category) }

// @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `alertCategorySingle`
// @parity /modules/vescape-core/src/index.ts `AlertSoundCategory`
private const val ALERT_CATEGORY_SINGLE = "single"

// @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `alertCategoryGeiger`
// @parity /modules/vescape-core/src/index.ts `AlertSoundCategory`
private const val ALERT_CATEGORY_GEIGER = "geiger"
