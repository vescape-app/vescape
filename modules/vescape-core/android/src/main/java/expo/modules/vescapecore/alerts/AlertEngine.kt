package expo.modules.vescapecore.alerts

import expo.modules.vescapecore.telemetry.formatValue
import expo.modules.vescapecore.telemetry.UnitPresentation
import expo.modules.vescapecore.telemetry.AppDataRepository

import expo.modules.vescapecore.protocol.RefloatTelemetry
import expo.modules.vescapecore.diagnostics.UnexpectedNativeError
import expo.modules.vescapecore.service.VESC_SESSION_TAG
import expo.modules.vescapecore.telemetry.telemetryMetricByControlId

import android.content.Context
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioAttributes
import android.media.AudioTrack
import android.media.SoundPool
import android.os.Handler
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.speech.tts.TextToSpeech
import android.util.Log
import expo.modules.vescapecore.telemetry.AlertRuleEntity
import expo.modules.vescapecore.telemetry.AppSettings
import java.util.concurrent.Executors
import kotlin.math.abs

/**
 * Floor on an Alert Rule's repeat cadence, in seconds.
 *
 * @parity /modules/vescape-core/src/index.ts `ALERT_REPEAT_MIN_SECONDS`
 * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `alertRepeatMinSeconds`
 */
const val ALERT_REPEAT_MIN_SECONDS = 3L

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

/** When speech may start after [severity]'s sound (its override, else [pack]'s) starts playing. */
internal fun speechDelayMs(context: Context, pack: String, slot: String): Long =
    maxOf(ALERT_SPEECH_DELAY_MS, slotClip(context, pack, slot)?.durationMs(context) ?: 0L)

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
    /** Audio looper every method hops to. A Board Session passes a dedicated thread, off main. */
    private val handler: Handler,
    /** Records a Diagnostic Event: a sound that started [ALERT_AUDIO_LATENCY_REPORT_MS] or more late. */
    private val onDiagnostic: (String, Map<String, Any?>) -> Unit = { _, _ -> },
) {
    // @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift
    // @platform-diff Android selects alarm/media streams; iOS retains its playback session.
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsPendingText: String? = null
    @Volatile private var released = false

    private var audioSource = "alarm"
    private fun newSoundPool() = SoundPool.Builder().setMaxStreams(8)
        .setAudioAttributes(audioAttributes(audioSource, AudioAttributes.CONTENT_TYPE_SONIFICATION)).build()
    private var soundPool = newSoundPool()
    /** SoundPool sample per `"<pack>/<slot>"` of every built-in effects pack. */
    private val soundIds = HashMap<String, Int>()
    /** SoundPool sample per My sound file path, loaded by [prepare] or on first play. */
    private val fileSamples = HashMap<String, Int>()
    /** Prepared MediaPlayer per My sound file path, so a one-shot My sound starts without a load. */
    private val readyMine = HashMap<String, ReadyClip>()
    /** Silent track holding audio output open between sounds while [wake]; null when idle. */
    private var warmTrack: AudioTrack? = null
    /** Sounds already reported late since [wake], one Diagnostic Event each. */
    private val lateReported = HashSet<String>()
    /** Last [prepare] input, replayed when the pool is rebuilt for a new audio source. */
    private var prepared: List<String> = emptyList()
    private val geigerLoops = HashMap<String, GeigerLoop>()
    private val samples = SoundSampleQueue()
    private val pendingGeiger = HashMap<String, PendingGeiger>()
    var soundPack: String = "retro"
    private var voice: String = VOICE_MATCHING
    @Volatile private var voiceLevel: String = VOICE_LEVEL_DEFAULT

    /** False at Voice level `off`: preset voice rules then play their severity sound only. */
    val presetVoiceEnabled: Boolean get() = voiceLevel != "off"
    /** Voice line playing now; a newer announcement or [release] stops it. */
    private var voiceTrack: AudioTrack? = null
    /** Bumped per voice announcement, so a line still decoding for an older one never plays. */
    private var voiceGeneration = 0

    /** Voice pack a line speaks with: the `voice` setting, where Matching follows the effects pack. */
    private fun voicePack(): String = voicePackId(voice, EffectsPackAssets.voice(context, soundPack))

    fun setSoundSettings(settings: AppSettings) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { setSoundSettings(settings) }
            return
        }
        if (released) return
        soundPack = settings.soundPack
        voice = settings.voice
        voiceLevel = settings.voiceLevel
        setAudioSource(settings.audioSource)
        val pack = voicePack()
        voiceExecutor.execute { VoicePackAssets.prewarm(context, pack) }
    }

    // Off the constructing thread: decoding every pack's slots must not hold up the caller.
    init { handler.post { loadAssets() } }

    /**
     * Ready everything [soundTypes] can play before the first alert: My sound samples and players
     * for every rule and slot override, and the voice pack's lines. Built-in pack slots are always
     * loaded.
     *
     * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `prepare`
     */
    fun prepare(soundTypes: List<String>) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { prepare(soundTypes) }
            return
        }
        if (released) return
        prepared = soundTypes
        val pack = soundPack
        val slots = EffectsPackAssets.slots(context).keys.map { it.substringAfter('/') }.distinct()
        val mine = HashSet<java.io.File>()
        for (slot in slots) {
            if (slotSample(slot, pack) != 0) (slotClip(context, pack, slot) as? SlotClip.Mine)?.let { mine += it.file }
        }
        for (soundType in soundTypes) {
            val my = mySoundId(soundType) ?: continue
            val slot = if (isGeigerSoundType(soundType)) geigerSlot(soundType) else parseSlotAlertSound(soundType).severity.slot
            slotSample(slot, pack, my)
            (slotClip(context, pack, slot, my) as? SlotClip.Mine)?.let { mine += it.file }
        }
        for (path in readyMine.keys - mine.map { it.path }.toSet()) readyMine.remove(path)?.player?.release()
        for (file in mine) if (file.path !in readyMine) readyMine[file.path] = prepareMine(file)
        val voice = voicePack()
        voiceExecutor.execute { VoicePackAssets.prewarm(context, voice) }
    }

    private class ReadyClip(val player: android.media.MediaPlayer) { var ready = false }

    private fun prepareMine(file: java.io.File): ReadyClip {
        val clip = ReadyClip(android.media.MediaPlayer())
        try {
            clip.player.setAudioAttributes(audioAttributes(audioSource, AudioAttributes.CONTENT_TYPE_SONIFICATION))
            clip.player.setDataSource(file.path)
            clip.player.setOnPreparedListener { clip.ready = true }
            clip.player.setOnErrorListener { _, _, _ -> clip.ready = false; true }
            clip.player.prepareAsync()
        } catch (e: Exception) {
            // intentional-suppression: an unprepared My sound plays through MySounds.play instead
            Log.w(VESC_SESSION_TAG, "My sound prepare failed: ${e.message}")
        }
        return clip
    }

    private fun releaseMine() {
        readyMine.values.forEach { it.player.release() }
        readyMine.clear()
    }

    /**
     * Hold audio output open for a Board Session: a looping silent track keeps the output (and a
     * Bluetooth link) from sleeping between sounds, so the first sound after a quiet stretch is not
     * clipped. [goIdle] lets it go.
     *
     * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `wake`
     */
    fun wake() {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { wake() }
            return
        }
        if (released) return
        lateReported.clear()
        if (warmTrack == null) warmTrack = startWarmTrack()
    }

    /**
     * Let audio output sleep between Board Sessions. Loaded sounds stay ready.
     *
     * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `goIdle`
     */
    fun goIdle() {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { goIdle() }
            return
        }
        warmTrack?.let(::releaseTrack)
        warmTrack = null
    }

    private fun startWarmTrack(): AudioTrack? = try {
        val rate = 8_000
        val frames = rate / 2
        AudioTrack.Builder()
            .setAudioAttributes(audioAttributes(audioSource, AudioAttributes.CONTENT_TYPE_SONIFICATION))
            .setAudioFormat(
                AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(rate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()
            )
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(frames * 2)
            .build()
            .apply {
                write(ShortArray(frames), 0, frames)
                setLoopPoints(0, frames, -1)
                play()
            }
    } catch (e: Exception) {
        UnexpectedNativeError.report("alert_audio_warm_start", "audio_start_failed", e)
        null
    }

    /** Report [sound] once per session when it started [ALERT_AUDIO_LATENCY_REPORT_MS] or more after [requestedAt]. */
    private fun reportLatency(sound: String, requestedAt: Long, path: String) {
        val latency = SystemClock.uptimeMillis() - requestedAt
        if (latency < ALERT_AUDIO_LATENCY_REPORT_MS || !lateReported.add(sound)) return
        onDiagnostic("alert_audio_latency", mapOf("sound" to sound, "latency_ms" to latency, "path" to path))
    }

    private fun loadAssets() {
        soundIds.clear()
        fileSamples.clear()
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
                for ((id, request) in loops) updateGeiger(id, request.soundType, request.rangeDepth)
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

    /**
     * Sample [slot] plays (see [slotClip]): My sound [my] or the slot's override, loaded on first
     * use, else the pack's; only the pack's when [mine] is false. A My sound that failed to load
     * falls back to the pack; 0 when nothing loaded. Geiger ticks play from here; one-shot My
     * sounds go through [playOnce], since SoundPool truncates long clips.
     */
    private fun slotSample(slot: String, pack: String = soundPack, my: String? = null, mine: Boolean = true): Int {
        val packSample = soundIds["${effectsPackId(pack)}/$slot"] ?: 0
        if (!mine) return packSample
        val clip = slotClip(context, pack, slot, my) as? SlotClip.Mine ?: return packSample
        val sample = fileSamples.getOrPut(clip.file.path) {
            // intentional-suppression: an unloadable My sound plays the pack slot instead
            runCatching { soundPool.load(clip.file.path, 1) }.getOrDefault(0)
        }
        return if (samples.state(sample) == SoundSampleQueue.State.FAILED) packSample else sample
    }

    fun setAudioSource(source: String) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { setAudioSource(source) }
            return
        }
        val selected = if (source == "media") "media" else "alarm"
        if (released || audioSource == selected) return
        val loops = geigerLoops.mapValues { (_, loop) -> PendingGeiger(loop.soundType, loop.rangeDepth) } + pendingGeiger
        val waitingPlays = samples.takePending()
        stopAllGeiger()
        soundPool.release()
        audioSource = selected
        soundPool = newSoundPool()
        pendingGeiger.clear()
        pendingGeiger.putAll(loops)
        loadAssets()
        waitingPlays.forEach { it() }
        releaseMine()
        prepare(prepared)
        if (warmTrack != null) { goIdle(); wake() }
        tts?.stop()
        tts?.setAudioAttributes(audioAttributes(audioSource, AudioAttributes.CONTENT_TYPE_SPEECH))
    }

    fun playConnect() = playAppCue("on")

    fun playDisconnect() = playAppCue("off")

    /**
     * Play app cue [cue] from the active effects pack; at Voice level `full` its voice line follows
     * once the effect has finished. Standard and Off play the effect only.
     *
     * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `playAppCue`
     */
    fun playAppCue(cue: String) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { playAppCue(cue) }
            return
        }
        val slot = appCueSlot(cue) ?: return
        val key = appCueVoiceKey(cue)
        if (voiceLevel == "full" && key != null) speakVoice(VoiceAnnouncement(AlertSeverity.INFO, key, null), slot)
        else playOnce(slot)
    }

    /**
     * Play [slot] once (see [slotClip]): a My sound through [MySounds.play], whole, falling back to
     * the pack's clip if it cannot play; otherwise the pack's sample.
     */
    /**
     * [onStart] runs once the sound starts, or gives up, so whatever follows it never starts early.
     */
    private fun playOnce(
        slot: String,
        my: String? = null,
        requestedAt: Long = SystemClock.uptimeMillis(),
        onStart: () -> Unit = {},
    ) {
        if (released) return
        val pack = soundPack
        val mine = slotClip(context, pack, slot, my) as? SlotClip.Mine
        if (mine == null) {
            playPackSlot(slot, pack, requestedAt, onStart)
            return
        }
        val ready = readyMine[mine.file.path]
        if (ready != null && ready.ready && !ready.player.isPlaying) {
            try {
                ready.player.seekTo(0)
                ready.player.start()
                reportLatency("my/$slot", requestedAt, "prepared")
                onStart()
                return
            } catch (e: Exception) {
                // intentional-suppression: a refused prepared player plays a fresh one instead
                ready.ready = false
            }
        }
        var started = false
        MySounds.play(mine.file, audioSource, this, onStart = {
            handler.post { started = true; reportLatency("my/$slot", requestedAt, "load"); onStart() }
        }) { failed -> if (failed) handler.post { if (!started) playPackSlot(slot, pack, requestedAt, onStart) } }
    }

    private fun playPackSlot(slot: String, pack: String, requestedAt: Long = SystemClock.uptimeMillis(), onStart: () -> Unit = {}) {
        if (released) return
        val sample = slotSample(slot, pack, mine = false)
        when (samples.state(sample)) {
            SoundSampleQueue.State.READY -> {
                playRaw(sample)
                reportLatency("$pack/$slot", requestedAt, "ready")
                onStart()
            }
            SoundSampleQueue.State.PENDING -> samples.enqueue(sample) { playPackSlot(slot, pack, requestedAt, onStart) }
            SoundSampleQueue.State.FAILED -> onStart()
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
        voiceTrack?.let(::releaseTrack)
        voiceTrack = null
        val existing = tts
        if (existing == null) {
            ttsPendingText = text
            // The engine reports on the main looper; its state belongs to the audio one.
            tts = TextToSpeech(context) { status -> handler.post { onTtsInit(status) } }
            return
        }
        if (!ttsReady) {
            ttsPendingText = text
            return
        }
        speakNow(text)
    }

    private fun onTtsInit(status: Int) {
        if (released) {
            tts?.shutdown()
            tts = null
            return
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

    private fun speakNow(text: String) {
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "vesc_alert")
    }

    /** Play when the Board Session ride ends. */
    fun playRideEnd() = playAppCue("ride.end")

    /**
     * Play one announcement: an `alert(count):severity` rule's severity sound from the active effects
     * pack, [count][SlotAlertSound.count] times, [ALERT_BEEP_SPACING_MS] apart.
     */
    fun playSingle(soundType: String, requestedAt: Long = SystemClock.uptimeMillis()) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { playSingle(soundType, requestedAt) }
            return
        }
        playSeverity(parseSlotAlertSound(soundType), mySoundId(soundType), requestedAt)
    }

    /** [sound]'s severity slot from the effects pack, or My sound [my] in its place, [SlotAlertSound.count] times. */
    private fun playSeverity(
        sound: SlotAlertSound,
        my: String? = null,
        requestedAt: Long = SystemClock.uptimeMillis(),
        onStart: () -> Unit = {},
    ) {
        try {
            val slot = sound.severity.slot
            val duration = slotClip(context, soundPack, slot, my)?.durationMs(context) ?: 0L
            val interval = if (duration > ALERT_BEEP_SPACING_MS) duration + ALERT_BEEP_SPACING_MS else ALERT_BEEP_SPACING_MS
            playOnce(slot, my, requestedAt, onStart)
            for (index in 1 until sound.count) {
                handler.postDelayed({ playOnce(slot, my) }, index * interval)
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
    fun speakAfterSeverity(severity: AlertSeverity, text: String, requestedAt: Long = SystemClock.uptimeMillis()) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { speakAfterSeverity(severity, text, requestedAt) }
            return
        }
        // A newer announcement supersedes speech still waiting out an older one's sound.
        pendingSpeech?.let { handler.removeCallbacks(it) }
        pendingSpeech = null
        val generation = ++voiceGeneration
        val delay = speechDelayMs(context, soundPack, severity.slot)
        // Timed from the sound's actual start, so a sound still loading never overlaps the speech.
        playSeverity(SlotAlertSound(1, severity), requestedAt = requestedAt) {
            if (released || generation != voiceGeneration) return@playSeverity
            val speech = Runnable { pendingSpeech = null; if (generation == voiceGeneration) speakMessage(text) }
            pendingSpeech = speech
            handler.postDelayed(speech, delay)
        }
    }

    private var pendingSpeech: Runnable? = null

    /**
     * Speak [announcement]: [slot] (its severity sound by default) once, then the voice pack line
     * joined with its value into one buffer, starting once the sound has finished. A key the pack
     * has no line for plays the sound only. Voice level is the caller's ([presetVoiceEnabled]).
     *
     * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `speakVoice`
     */
    fun speakVoice(
        announcement: VoiceAnnouncement,
        slot: String = announcement.severity.slot,
        requestedAt: Long = SystemClock.uptimeMillis(),
    ) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { speakVoice(announcement, slot, requestedAt) }
            return
        }
        if (released) return
        pendingSpeech?.let { handler.removeCallbacks(it) }
        pendingSpeech = null
        val generation = ++voiceGeneration
        val delay = speechDelayMs(context, soundPack, slot)
        // The line is due [delay] after the sound actually starts, so a sound still loading never
        // overlaps it; both callbacks land on the audio looper.
        var due: Long? = null
        var line: VoicePcm? = null
        fun speakWhenDue() {
            val at = due ?: return
            val pcm = line ?: return
            if (released || generation != voiceGeneration) return
            val speech = Runnable { pendingSpeech = null; if (generation == voiceGeneration) playVoice(pcm) }
            pendingSpeech = speech
            handler.postAtTime(speech, maxOf(at, SystemClock.uptimeMillis()))
        }
        playOnce(slot, requestedAt = requestedAt) { due = SystemClock.uptimeMillis() + delay; speakWhenDue() }
        val pack = voicePack()
        // Decoding runs off the audio looper while the severity sound covers it.
        voiceExecutor.execute {
            val pcm = VoicePackAssets.join(context, pack, announcement) ?: return@execute
            handler.post { line = pcm; speakWhenDue() }
        }
    }

    private fun playVoice(pcm: VoicePcm) {
        if (released) return
        voiceTrack?.let(::releaseTrack)
        ttsPendingText = null
        tts?.stop()
        voiceTrack = playPcm(pcm, audioSource, handler) { track -> if (voiceTrack === track) voiceTrack = null }
    }

    fun preview(soundType: String) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { preview(soundType) }
            return
        }
        parseVoiceAlertSound(soundType)?.let { sound ->
            val unitSystem = kotlinx.coroutines.runBlocking { AppDataRepository.get(context).getTypedSettings().unitSystem }
            speakVoice(voiceAnnouncement(sound, null, null, percentAvailable = true, unitSystem = unitSystem))
            return
        }
        val tts = parseTtsAlertSound(soundType)
        if (tts != null) {
            val text = renderAlertMessageTemplate(tts.text, ttsSampleAlert(soundType), batteryPercent = 42.0, unitSystem = kotlinx.coroutines.runBlocking { AppDataRepository.get(context).getTypedSettings().unitSystem })
            if (text.isNotEmpty()) speakAfterSeverity(tts.severity, text)
            return
        }
        try {
            playOnce(previewSlot(soundType), my = mySoundId(soundType))
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
        val my = mySoundId(soundType)
        val sample = slotSample(tickSlot, my = my)
        if (samples.state(sample) == SoundSampleQueue.State.FAILED) { stopGeiger(ruleId); return }
        if (samples.state(sample) == SoundSampleQueue.State.PENDING) {
            pendingGeiger[ruleId] = PendingGeiger(soundType, rangeDepth)
            return
        }
        try {
            val depth = rangeDepth.coerceIn(0.0, 1.0)
            val existing = geigerLoops[ruleId]
            if (depth >= 1.0) {
                existing?.runnable?.let { handler.removeCallbacks(it) }
                // A pack switch changes the sample, so the loop restarts on the new one.
                if (existing?.sustained == true && existing.sample == sample) return
                existing?.streamId?.let { soundPool.stop(it) }
                val streamId = playSlot(tickSlot, loop = -1, my = my)
                geigerLoops[ruleId] = GeigerLoop(soundType, depth, sustained = true, streamId = streamId, sample = sample)
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
                    // Resolved per tick, so an app-wide pack switch mid-loop takes effect.
                    playSlot(tickSlot, my = my)
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
        voiceTrack?.let(::releaseTrack)
        voiceTrack = null
        warmTrack?.let(::releaseTrack)
        warmTrack = null
        releaseMine()
        samples.reset()
        MySounds.releasePlayers(this)
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

    private fun playSlot(slot: String, loop: Int = 0, my: String? = null, requestedAt: Long = SystemClock.uptimeMillis()): Int {
        if (released) return 0
        val soundId = slotSample(slot, my = my)
        if (soundId == 0 || samples.state(soundId) == SoundSampleQueue.State.FAILED) return 0
        if (samples.state(soundId) == SoundSampleQueue.State.PENDING) {
            samples.enqueue(soundId) { playSlot(slot, loop, my, requestedAt) }
            return 0
        }
        return soundPool.play(soundId, 1f, 1f, 1, loop, 1f)
          .also { check(it != 0) { "SoundPool refused playback" } }
          .also { reportLatency("$soundPack/$slot", requestedAt, "ready") }
    }

    private fun geigerIntervalMs(rangeDepth: Double): Long =
        (800L - (740L * rangeDepth.coerceIn(0.0, 1.0))).toLong().coerceIn(60L, 800L)

    private data class PendingGeiger(val soundType: String, val rangeDepth: Double)

    private data class GeigerLoop(
        val soundType: String,
        var rangeDepth: Double,
        val sustained: Boolean,
        val streamId: Int? = null,
        var runnable: Runnable? = null,
        /** Sample a sustained loop plays. */
        val sample: Int = 0,
    )

    companion object {
        /** Decodes and joins voice lines off the audio looper. */
        private val voiceExecutor = Executors.newSingleThreadExecutor { Thread(it, "vescape-voice").apply { isDaemon = true } }

        /**
         * Play [pcm] once on its own static [AudioTrack] on [source]'s stream, released once it has
         * finished; [onDone] runs then on [handler]. Null when the track could not start.
         */
        private fun playPcm(pcm: VoicePcm, source: String, handler: Handler, onDone: (AudioTrack) -> Unit = {}): AudioTrack? {
            if (pcm.samples.isEmpty()) return null
            return try {
                val track = AudioTrack.Builder()
                    .setAudioAttributes(audioAttributes(source, AudioAttributes.CONTENT_TYPE_SPEECH))
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(pcm.sampleRate)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build()
                    )
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .setBufferSizeInBytes(pcm.samples.size * 2)
                    .build()
                track.write(pcm.samples, 0, pcm.samples.size)
                track.play()
                handler.postDelayed({ releaseTrack(track); onDone(track) }, pcm.durationMs + 300)
                track
            } catch (e: Exception) {
                UnexpectedNativeError.report("alert_voice_play", "audio_play_failed", e)
                null
            }
        }

        private fun releaseTrack(track: AudioTrack) {
            // intentional-suppression: a track already released or never started has nothing to stop
            runCatching { track.stop() }
            track.release()
        }

        /** Preview without requiring a running board session. */
        fun previewAppSound(context: Context, pack: String, cue: String, source: String) {
            val slot = appCueSlot(cue) ?: return
            previewClip(context, Handler(contextMainLooper()), pack, slot, source = source)
        }

        fun preview(context: Context, soundType: String, source: String) {
            val handler = Handler(contextMainLooper())
            val settings = kotlinx.coroutines.runBlocking { AppDataRepository.get(context).getTypedSettings() }
            parseVoiceAlertSound(soundType)?.let { sound ->
                val announcement = voiceAnnouncement(sound, null, null, percentAvailable = true, unitSystem = settings.unitSystem)
                val pack = voicePackId(settings.voice, EffectsPackAssets.voice(context, settings.soundPack))
                var pcm: VoicePcm? = null
                var soundDone = false
                fun speakWhenReady() {
                    if (!soundDone) return
                    pcm?.let { pcm = null; playPcm(it, source, handler) }
                }
                voiceExecutor.execute {
                    val joined = VoicePackAssets.join(context, pack, announcement) ?: return@execute
                    handler.post { pcm = joined; speakWhenReady() }
                }
                previewClip(context, handler, settings.soundPack, sound.severity.slot, source = source, doneAfterMs = speechDelayMs(context, settings.soundPack, sound.severity.slot)) {
                    soundDone = true
                    speakWhenReady()
                }
                return
            }
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
                previewClip(context, handler, settings.soundPack, tts.severity.slot, source = source, doneAfterMs = speechDelayMs(context, settings.soundPack, tts.severity.slot)) {
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
            previewClip(context, handler, settings.soundPack, previewSlot(soundType), mySoundId(soundType), source)
        }

        /**
         * Play [slot] once as [slotClip] resolves it. A My sound plays whole through
         * [MySounds.play] and falls back to [pack]'s clip if it cannot. [onDone] runs once the
         * sound has finished.
         */
        private fun previewClip(context: Context, handler: Handler, pack: String, slot: String, my: String? = null, source: String, doneAfterMs: Long = 0L, onDone: (() -> Unit)? = null) {
            val packPath = { EffectsPackAssets.path(context, pack, slot) }
            when (val clip = slotClip(context, pack, slot, my)) {
                is SlotClip.Mine -> MySounds.play(clip.file, source) { failed ->
                    handler.post {
                        if (failed) previewAsset(context, handler, packPath(), source, doneAfterMs, onDone) else onDone?.invoke()
                    }
                }
                is SlotClip.Asset -> previewAsset(context, handler, clip.path, source, doneAfterMs, onDone)
                null -> previewAsset(context, handler, null, source, doneAfterMs, onDone)
            }
        }

        /**
         * Play the pack clip at asset [path] once on a throwaway pool. [onDone] runs once it has
         * finished, or right away if the sample fails to load.
         */
        private fun previewAsset(context: Context, handler: Handler, path: String?, source: String, doneAfterMs: Long, onDone: (() -> Unit)?) {
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

/**
 * A sound starting this late after its request records an `alert_audio_latency` Diagnostic Event.
 *
 * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `alertAudioLatencyReportMs`
 */
internal const val ALERT_AUDIO_LATENCY_REPORT_MS = 150L
