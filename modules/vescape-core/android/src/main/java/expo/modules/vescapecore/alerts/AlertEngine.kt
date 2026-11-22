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
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import expo.modules.vescapecore.database.AlertRuleEntity
import expo.modules.vescapecore.database.AppSettings
import java.util.concurrent.Executors
import kotlin.math.abs
import androidx.annotation.BinderThread

/**
 * @parity /modules/vescape-core/src/index.ts `ALERT_REPEAT_MIN_SECONDS`
 * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `alertRepeatMinSeconds`
 */
const val ALERT_REPEAT_MIN_SECONDS = 3L

internal const val ALERT_BEEP_SPACING_MS = 350L

fun normalizedAlertRepeatSeconds(raw: Double?): Long? {
    if (raw == null || !raw.isFinite() || raw <= 0.0) return null
    return maxOf(ALERT_REPEAT_MIN_SECONDS, Math.round(raw))
}

/**
 * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `alertSpeechDelayMs`
 */
internal const val ALERT_SPEECH_DELAY_MS = 350L
internal const val ALERT_SPEECH_MAX_DELAY_MS = 1500L

internal fun speechDelayMs(context: Context, pack: String, slot: String): Long =
    (slotClip(context, pack, slot)?.durationMs(context) ?: 0L).coerceIn(ALERT_SPEECH_DELAY_MS, ALERT_SPEECH_MAX_DELAY_MS)

internal fun alertControlUnit(controlId: String): String =
    telemetryMetricByControlId[controlId]?.unit ?: ""

private fun formatAlertValue(value: Double, controlId: String): String =
    telemetryMetricByControlId[controlId]?.formatValue(value) ?: "%.0f".format(value)

internal fun renderAlertMessageTemplate(
    template: String,
    alert: FiredAlert,
    batteryPercent: Double?,
    onDiagnostic: ((String, Map<String, Any?>) -> Unit)? = null,
    distanceUnit: String = "km",
): String {
    // @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `renderAlertMessageTemplate`
    val isBattery = alert.controlId == "battery"
    fun format(value: Double) = if (alert.controlId == "speed") UnitPresentation.formatSpokenSpeed(value, distanceUnit) else formatAlertValue(value, alert.controlId)
    var text = template
    text = text.replace("{value}", format(alert.value))
    text = text.replace("{threshold}", format(alert.threshold))
    text = text.replace("{unit}", if (alert.controlId == "speed") UnitPresentation.speedUnit(distanceUnit) else alertControlUnit(alert.controlId))
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

private fun ttsSampleAlert(spec: String) = FiredAlert(
    ruleId = "preview",
    controlId = "battery",
    value = 48.0,
    threshold = 50.0,
    thresholdMax = null,
    spec = spec,
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
    val spec: String,
    val rangeDepth: Double?,
    val firedAt: Long,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "ruleId" to ruleId,
        "controlId" to controlId,
        "value" to value,
        "threshold" to threshold,
        "thresholdMax" to thresholdMax,
        "spec" to spec,
        "rangeDepth" to rangeDepth,
        "firedAt" to firedAt,
    )
}

/**
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
        spec = "geiger:soft",
        createdAt = 0L,
    )
}

internal class AlertEngine(private val nowMs: () -> Long = { System.currentTimeMillis() }) {
    // @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `AlertEngine`
    private val lastFiredAt = HashMap<String, Long>()
    private val armedState = HashMap<String, Boolean>()
    private var configValues: Map<String, Any> = emptyMap()
    private var motorConfigValues: Map<String, Any> = emptyMap()

    fun updateBoardConfigValues(values: Map<String, Any>) { configValues = values }

    fun updateMotorConfigValues(values: Map<String, Any>) { motorConfigValues = values }

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
        val now = nowMs()
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
        spec = spec,
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
     * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `hasRearmed`
     */
    private fun hasRearmed(compareValue: Double, rule: AlertRuleEntity, effectiveThreshold: Double, aboveDir: Boolean): Boolean {
        val margin = alertRearmMargin(rule.controlId, effectiveThreshold)
        return if (aboveDir) compareValue < effectiveThreshold - margin else compareValue > effectiveThreshold + margin
    }

    private fun alertRearmMargin(controlId: String, threshold: Double): Double =
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
    private val onDiagnostic: (String, Map<String, Any?>) -> Unit = { _, _ -> },
) {
    // @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift
    // @platform-diff Android selects alarm/media streams; iOS retains its playback session.
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsPending: Pair<String, PlaybackCompletion>? = null
    private val utterances = HashMap<String, PlaybackCompletion>()
    private var utteranceSeq = 0
    @Volatile private var released = false

    private var audioSource = "alarm"
    private fun newSoundPool() = SoundPool.Builder().setMaxStreams(8)
        .setAudioAttributes(audioAttributes(audioSource, AudioAttributes.CONTENT_TYPE_SONIFICATION)).build()
    private var soundPool = newSoundPool()
    private val soundIds = HashMap<String, Int>()
    private val fileSamples = HashMap<String, Int>()
    private val readyMine = HashMap<String, ReadyClip>()
    private var warmTrack: AudioTrack? = null
    private val lateReported = HashSet<String>()
    private var prepared: List<String> = emptyList()
    private val geigerLoops = HashMap<String, GeigerLoop>()
    private val samples = SoundSampleQueue()
    private val pendingGeiger = HashMap<String, PendingGeiger>()
    var soundPack: String = EFFECTS_PACK_FALLBACK
    private var voice: String = VOICE_MATCHING
    @Volatile private var voiceLevel: String = VOICE_LEVEL_DEFAULT

    val presetVoiceEnabled: Boolean get() = voiceLevel != "off"
    private var voiceTrack: AudioTrack? = null
    private var voiceGeneration = 0
    private val playback = PlaybackTracker { handler.post(it) }

    /**
     * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `track`
     */
    private fun track(onDone: PlaybackDone): PlaybackCompletion = playback.start(onDone).also { done ->
        handler.postDelayed({ done.finish(PlaybackOutcome.FAILED) }, PLAYBACK_DONE_TIMEOUT_MS)
    }

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

    init { handler.post { loadAssets() } }

    /**
     * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `prepare`
     */
    fun prepare(Specs: List<String>) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { prepare(Specs) }
            return
        }
        if (released) return
        prepared = Specs
        val pack = soundPack
        val slots = (EffectsPackAssets.slots(context).keys.map { it.substringAfter('/') } + OPTIONAL_SLOT_FALLBACK.keys).distinct()
        val mine = HashSet<java.io.File>()
        for (slot in slots) {
            if (slotSample(slot, pack) != 0) (slotClip(context, pack, slot) as? SlotClip.Mine)?.let { mine += it.file }
        }
        for (spec in Specs) {
            val my = mySoundId(spec) ?: continue
            val slot = if (isGeigerSpec(spec)) geigerSlot(spec) else parseSlotAlertSound(spec).severity.slot
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
                for ((id, request) in loops) updateGeiger(id, request.spec, request.rangeDepth)
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

    private fun slotSample(slot: String, pack: String = soundPack, my: String? = null, mine: Boolean = true): Int {
        val packSample = soundIds["${effectsPackId(pack)}/${EffectsPackAssets.packSlot(context, pack, slot)}"] ?: 0
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
        val loops = geigerLoops.mapValues { (_, loop) -> PendingGeiger(loop.spec, loop.rangeDepth) } + pendingGeiger
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

    /**
     * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `boardConnected`
     */
    fun boardConnected(playCue: Boolean) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { boardConnected(playCue) }
            return
        }
        announcements.connected(SystemClock.uptimeMillis())
        if (playCue) playAppCue("on")
    }

    /**
     * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `boardDisconnected`
     */
    fun boardDisconnected(playCue: Boolean) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { boardDisconnected(playCue) }
            return
        }
        clearAnnouncements()
        if (playCue) playAppCue("off")
    }

    /**
     * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `playAppCue`
     */
    fun playAppCue(cue: String, onDone: PlaybackDone = {}) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { playAppCue(cue, onDone) }
            return
        }
        val priority = appCuePriority(cue) ?: run { onDone(PlaybackOutcome.FAILED); return }
        announce(priority, onDone) { done -> playAppCueNow(cue, done) }
    }

    private fun playAppCueNow(cue: String, done: PlaybackCompletion) {
        val slot = appCueSlot(cue) ?: run { done.finish(PlaybackOutcome.FAILED); return }
        val key = if (appCueSpeaks(cue, voiceLevel)) appCueVoiceKey(cue) else null
        if (key != null) speakVoiceTracked(VoiceAnnouncement(AlertSeverity.INFO, key), slot, SystemClock.uptimeMillis(), done)
        else playOnce(slot, onDone = { done.finish(it) })
    }

    private class QueuedAnnouncement(val play: (PlaybackCompletion) -> Unit, val onDone: PlaybackDone) {
        var attempt: PlaybackCompletion? = null
    }

    private val announcements = AnnouncementQueue<QueuedAnnouncement>()
    private val pumpRunnable = Runnable { pumpAnnouncements() }

    /**
     * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `announce`
     */
    private fun announce(
        priority: AnnouncementPriority,
        onDone: PlaybackDone,
        ttlMs: Long = priority.ttlMs,
        play: (PlaybackCompletion) -> Unit,
    ) {
        if (released) { onDone(PlaybackOutcome.CANCELLED); return }
        announcements.enqueue(QueuedAnnouncement(play, onDone), priority, SystemClock.uptimeMillis(), ttlMs)
        pumpAnnouncements()
    }

    private fun pumpAnnouncements() {
        handler.removeCallbacks(pumpRunnable)
        if (released) return
        val now = SystemClock.uptimeMillis()
        when (val step = announcements.next(now) { it.onDone(PlaybackOutcome.CANCELLED) }) {
            is AnnouncementStep.Play -> {
                val item = step.item
                val attempt = track { outcome ->
                    if (announcements.playing !== item) return@track
                    announcements.finished(outcome, SystemClock.uptimeMillis())?.onDone?.invoke(outcome)
                    pumpAnnouncements()
                }
                item.attempt = attempt
                item.play(attempt)
            }
            is AnnouncementStep.WaitUntil -> handler.postAtTime(pumpRunnable, step.at)
            AnnouncementStep.Idle -> Unit
        }
    }

    private fun stopAnnouncement(item: QueuedAnnouncement) {
        val attempt = item.attempt ?: return
        if (!playback.isSpeech(attempt)) {
            attempt.finish(PlaybackOutcome.COMPLETED)
            return
        }
        stopSpeech()
        attempt.finish(PlaybackOutcome.CANCELLED)
    }

    private fun clearAnnouncements() {
        handler.removeCallbacks(pumpRunnable)
        for (item in announcements.clear()) {
            stopAnnouncement(item)
            item.onDone(PlaybackOutcome.CANCELLED)
        }
    }

    private fun critical(onDone: PlaybackDone): PlaybackDone {
        announcements.criticalStarted()?.let(::stopAnnouncement)
        return { outcome ->
            announcements.criticalEnded(SystemClock.uptimeMillis())
            pumpAnnouncements()
            onDone(outcome)
        }
    }

    private fun stopSpeech() {
        pendingSpeech?.let { handler.removeCallbacks(it) }
        pendingSpeech = null
        voiceGeneration++
        voiceTrack?.let(::releaseTrack)
        voiceTrack = null
        ttsPending = null
        tts?.stop()
    }

    private fun playOnce(
        slot: String,
        my: String? = null,
        requestedAt: Long = SystemClock.uptimeMillis(),
        onDone: PlaybackDone = {},
        onStart: () -> Unit = {},
    ) {
        if (released) { onDone(PlaybackOutcome.CANCELLED); return }
        val pack = soundPack
        val mine = slotClip(context, pack, slot, my) as? SlotClip.Mine
        if (mine == null) {
            playPackSlot(slot, pack, requestedAt, onDone, onStart)
            return
        }
        val ready = readyMine[mine.file.path]
        if (ready != null && ready.ready && !ready.player.isPlaying) {
            try {
                ready.player.seekTo(0)
                ready.player.start()
                reportLatency("my/$slot", requestedAt, "prepared")
                onStart()
                handler.postDelayed({ onDone(PlaybackOutcome.COMPLETED) }, MySounds.durationMs(mine.file))
                return
            } catch (e: Exception) {
                // intentional-suppression: a refused prepared player plays a fresh one instead
                ready.ready = false
            }
        }
        var started = false
        MySounds.play(mine.file, audioSource, this, onStart = {
            handler.post { started = true; reportLatency("my/$slot", requestedAt, "load"); onStart() }
        }) { failed ->
            handler.post {
                if (failed && !started) playPackSlot(slot, pack, requestedAt, onDone, onStart)
                else onDone(if (failed) PlaybackOutcome.FAILED else PlaybackOutcome.COMPLETED)
            }
        }
    }

    private fun playPackSlot(
        slot: String,
        pack: String,
        requestedAt: Long = SystemClock.uptimeMillis(),
        onDone: PlaybackDone = {},
        onStart: () -> Unit = {},
    ) {
        if (released) { onDone(PlaybackOutcome.CANCELLED); return }
        val sample = slotSample(slot, pack, mine = false)
        when (samples.state(sample)) {
            SoundSampleQueue.State.READY -> {
                val played = playRaw(sample)
                reportLatency("$pack/$slot", requestedAt, "ready")
                onStart()
                if (!played) onDone(PlaybackOutcome.FAILED)
                else handler.postDelayed({ onDone(PlaybackOutcome.COMPLETED) }, EffectsPackAssets.durationMs(context, pack, slot))
            }
            SoundSampleQueue.State.PENDING -> samples.enqueue(sample) { playPackSlot(slot, pack, requestedAt, onDone, onStart) }
            SoundSampleQueue.State.FAILED -> { onStart(); onDone(PlaybackOutcome.FAILED) }
        }
    }

    private fun playRaw(soundId: Int): Boolean {
        if (released) return false
        if (soundId == 0) {
            UnexpectedNativeError.report("alert_audio_connection_asset", "bundled_asset", IllegalStateException())
            return false
        }
        return try {
            check(soundPool.play(soundId, 1f, 1f, 1, 0, 1f) != 0) { "SoundPool refused playback" }
            true
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Connection sound failed: ${e.message}")
            UnexpectedNativeError.report("alert_audio_connection_play", "audio_play_failed", e)
            false
        }
    }

    private fun speakTracked(text: String, done: PlaybackCompletion) {
        if (released) { done.finish(PlaybackOutcome.CANCELLED); return }
        voiceTrack?.let(::releaseTrack)
        voiceTrack = null
        val existing = tts
        if (existing == null) {
            ttsPending = text to done
            tts = TextToSpeech(context) { status -> handler.post { onTtsInit(status) } }
            return
        }
        if (!ttsReady) {
            ttsPending = text to done
            return
        }
        speakNow(text, done)
    }

    private fun onTtsInit(status: Int) {
        if (released) {
            tts?.shutdown()
            tts = null
            return
        }
        if (status == TextToSpeech.SUCCESS) {
            tts?.setAudioAttributes(audioAttributes(audioSource, AudioAttributes.CONTENT_TYPE_SPEECH))
            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                @BinderThread
                override fun onStart(utteranceId: String) {}
                @BinderThread
                override fun onDone(utteranceId: String) = utteranceEnded(utteranceId, PlaybackOutcome.COMPLETED)
                @Deprecated("Superseded by onError(String, Int)")
                @BinderThread
                override fun onError(utteranceId: String) = utteranceEnded(utteranceId, PlaybackOutcome.FAILED)
                @BinderThread
                override fun onError(utteranceId: String, errorCode: Int) = utteranceEnded(utteranceId, PlaybackOutcome.FAILED)
                @BinderThread
                override fun onStop(utteranceId: String, interrupted: Boolean) = utteranceEnded(utteranceId, PlaybackOutcome.CANCELLED)
            })
            ttsReady = true
            val pending = ttsPending
            ttsPending = null
            if (pending != null) speakNow(pending.first, pending.second)
        } else {
            ttsPending?.second?.finish(PlaybackOutcome.FAILED)
            ttsPending = null
            Log.w(VESC_SESSION_TAG, "TTS init failed status=$status")
            UnexpectedNativeError.report("alert_audio_tts_init", "audio_start_failed", IllegalStateException("TTS status $status"))
        }
    }

    private fun speakNow(text: String, done: PlaybackCompletion) {
        val engine = tts ?: run { done.finish(PlaybackOutcome.FAILED); return }
        val id = "vesc_alert_${++utteranceSeq}"
        utterances[id] = done
        if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) {
            utterances.remove(id)
            done.finish(PlaybackOutcome.FAILED)
        }
    }

    private fun utteranceEnded(id: String, outcome: PlaybackOutcome) {
        handler.post { utterances.remove(id)?.finish(outcome) }
    }

    fun playSingle(spec: String, requestedAt: Long = SystemClock.uptimeMillis(), onDone: PlaybackDone = {}) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { playSingle(spec, requestedAt, onDone) }
            return
        }
        val done = track(critical(onDone))
        playSeverity(parseSlotAlertSound(spec), mySoundId(spec), requestedAt, onDone = { done.finish(it) })
    }

    private fun playSeverity(
        sound: SlotAlertSound,
        my: String? = null,
        requestedAt: Long = SystemClock.uptimeMillis(),
        onDone: PlaybackDone = {},
        onStart: () -> Unit = {},
    ) {
        try {
            val slot = sound.severity.slot
            val duration = slotClip(context, soundPack, slot, my)?.durationMs(context) ?: 0L
            val interval = if (duration > ALERT_BEEP_SPACING_MS) duration + ALERT_BEEP_SPACING_MS else ALERT_BEEP_SPACING_MS
            fun doneAt(index: Int): PlaybackDone = if (index == sound.count - 1) onDone else ({})
            playOnce(slot, my, requestedAt, doneAt(0), onStart)
            for (index in 1 until sound.count) {
                handler.postDelayed({ playOnce(slot, my, onDone = doneAt(index)) }, index * interval)
            }
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Alert sound failed: ${e.message}")
            UnexpectedNativeError.report("alert_audio_single_play", "audio_play_failed", e)
            onDone(PlaybackOutcome.FAILED)
        }
    }

    /**
     * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `speakAfterSeverity`
     */
    fun speakAfterSeverity(
        severity: AlertSeverity,
        text: String,
        requestedAt: Long = SystemClock.uptimeMillis(),
        onDone: PlaybackDone = {},
    ) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { speakAfterSeverity(severity, text, requestedAt, onDone) }
            return
        }
        val done = track(critical(onDone))
        if (released) { done.finish(PlaybackOutcome.CANCELLED); return }
        pendingSpeech?.let { handler.removeCallbacks(it) }
        pendingSpeech = null
        playback.claimSpeech(done)
        val generation = ++voiceGeneration
        val delay = speechDelayMs(context, soundPack, severity.slot)
        playSeverity(SlotAlertSound(1, severity), requestedAt = requestedAt) {
            if (released || generation != voiceGeneration) return@playSeverity
            val speech = Runnable { pendingSpeech = null; if (generation == voiceGeneration) speakTracked(text, done) }
            pendingSpeech = speech
            handler.postDelayed(speech, delay)
        }
    }

    private var pendingSpeech: Runnable? = null

    /**
     * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `speakVoice`
     */
    fun speakVoice(
        announcement: VoiceAnnouncement,
        slot: String = announcement.severity.slot,
        requestedAt: Long = SystemClock.uptimeMillis(),
        onDone: PlaybackDone = {},
    ) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { speakVoice(announcement, slot, requestedAt, onDone) }
            return
        }
        speakVoiceTracked(announcement, slot, requestedAt, track(critical(onDone)))
    }

    /**
     * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `speakAdvisory`
     */
    fun speakAdvisory(announcement: VoiceAnnouncement, onDone: PlaybackDone = {}) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { speakAdvisory(announcement, onDone) }
            return
        }
        if (!presetVoiceEnabled) { onDone(PlaybackOutcome.CANCELLED); return }
        announce(AnnouncementPriority.ADVISORY, onDone) { done ->
            speakVoiceTracked(announcement, announcement.severity.slot, SystemClock.uptimeMillis(), done)
        }
    }

    private fun speakVoiceTracked(announcement: VoiceAnnouncement, slot: String, requestedAt: Long, done: PlaybackCompletion) {
        if (released) { done.finish(PlaybackOutcome.CANCELLED); return }
        pendingSpeech?.let { handler.removeCallbacks(it) }
        pendingSpeech = null
        playback.claimSpeech(done)
        val generation = ++voiceGeneration
        val delay = speechDelayMs(context, soundPack, slot)
        var due: Long? = null
        var line: VoicePcm? = null
        var noLine = false
        var lead: PlaybackOutcome? = null
        fun finishWithoutLine() { if (noLine) lead?.let { done.finish(it) } }
        fun speakWhenDue() {
            val at = due ?: return
            val pcm = line ?: return
            if (released || generation != voiceGeneration) return
            val speech = Runnable { pendingSpeech = null; if (generation == voiceGeneration) playVoice(pcm, done) }
            pendingSpeech = speech
            handler.postAtTime(speech, maxOf(at, SystemClock.uptimeMillis()))
        }
        playOnce(slot, requestedAt = requestedAt, onDone = { lead = it; finishWithoutLine() }) {
            due = SystemClock.uptimeMillis() + delay
            speakWhenDue()
        }
        val pack = voicePack()
        voiceExecutor.execute {
            val pcm = VoicePackAssets.join(context, pack, announcement.copy(wording = VoiceWording.of(voiceLevel)))
            handler.post {
                if (pcm == null) { noLine = true; finishWithoutLine() } else { line = pcm; speakWhenDue() }
            }
        }
    }

    private fun playVoice(pcm: VoicePcm, done: PlaybackCompletion) {
        if (released) { done.finish(PlaybackOutcome.CANCELLED); return }
        voiceTrack?.let(::releaseTrack)
        ttsPending = null
        tts?.stop()
        voiceTrack = playPcm(pcm, audioSource, handler) { track ->
            if (voiceTrack === track) voiceTrack = null
            done.finish(PlaybackOutcome.COMPLETED)
        }
        if (voiceTrack == null) done.finish(PlaybackOutcome.FAILED)
    }

    fun preview(spec: String) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { preview(spec) }
            return
        }
        parseVoiceAlertSound(spec)?.let { sound ->
            val settings = kotlinx.coroutines.runBlocking { AppDataRepository.get(context).getTypedSettings() }
            speakVoice(voiceAnnouncement(sound, null, null, percentAvailable = true, distanceUnit = settings.distanceUnit, temperatureUnit = settings.temperatureUnit))
            return
        }
        val tts = parseTtsAlertSound(spec)
        if (tts != null) {
            val text = renderAlertMessageTemplate(tts.text, ttsSampleAlert(spec), batteryPercent = 42.0, distanceUnit = kotlinx.coroutines.runBlocking { AppDataRepository.get(context).getTypedSettings().distanceUnit })
            if (text.isNotEmpty()) speakAfterSeverity(tts.severity, text)
            return
        }
        try {
            playOnce(previewSlot(spec), my = mySoundId(spec))
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Alert preview failed: ${e.message}")
            UnexpectedNativeError.report("alert_audio_preview", "audio_play_failed", e)
        }
    }

    fun updateGeiger(ruleId: String, spec: String, rangeDepth: Double) {
        if (android.os.Looper.myLooper() != handler.looper) {
            handler.post { updateGeiger(ruleId, spec, rangeDepth) }
            return
        }
        if (released) return
        val tickSlot = geigerSlot(spec)
        val my = mySoundId(spec)
        val sample = slotSample(tickSlot, my = my)
        if (samples.state(sample) == SoundSampleQueue.State.FAILED) { stopGeiger(ruleId); return }
        if (samples.state(sample) == SoundSampleQueue.State.PENDING) {
            pendingGeiger[ruleId] = PendingGeiger(spec, rangeDepth)
            return
        }
        try {
            val depth = rangeDepth.coerceIn(0.0, 1.0)
            val existing = geigerLoops[ruleId]
            if (depth >= 1.0) {
                existing?.runnable?.let { handler.removeCallbacks(it) }
                if (existing?.sustained == true && existing.sample == sample) return
                existing?.streamId?.let { soundPool.stop(it) }
                val streamId = playSlot(tickSlot, loop = -1, my = my)
                geigerLoops[ruleId] = GeigerLoop(spec, depth, sustained = true, streamId = streamId, sample = sample)
                return
            }

            if (existing?.sustained == true) {
                existing.streamId?.let { soundPool.stop(it) }
            }
            if (existing != null && !existing.sustained && existing.spec == spec) {
                existing.rangeDepth = depth
                return
            }
            existing?.runnable?.let { handler.removeCallbacks(it) }
            val loop = GeigerLoop(spec, depth, sustained = false)
            val runnable = object : Runnable {
                override fun run() {
                    if (released || geigerLoops[ruleId] !== loop) return
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
        clearAnnouncements()
        released = true
        playback.cancelAll()
        utterances.clear()
        ttsPending = null
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

    private data class PendingGeiger(val spec: String, val rangeDepth: Double)

    private data class GeigerLoop(
        val spec: String,
        var rangeDepth: Double,
        val sustained: Boolean,
        val streamId: Int? = null,
        var runnable: Runnable? = null,
        val sample: Int = 0,
    )

    companion object {
        private val voiceExecutor = Executors.newSingleThreadExecutor { Thread(it, "vescape-voice").apply { isDaemon = true } }

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

        fun previewPackSound(context: Context, pack: String, slot: String, source: String) {
            previewClip(context, Handler(contextMainLooper()), pack, slot, source = source)
        }

        fun previewVoice(context: Context, voice: VoiceAnnouncement, source: String) {
            val handler = Handler(contextMainLooper())
            val settings = kotlinx.coroutines.runBlocking { AppDataRepository.get(context).getTypedSettings() }
            val announcement = voice.copy(wording = VoiceWording.of(settings.voiceLevel))
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
            previewClip(context, handler, settings.soundPack, announcement.severity.slot, source = source, doneAfterMs = speechDelayMs(context, settings.soundPack, announcement.severity.slot)) {
                soundDone = true
                speakWhenReady()
            }
        }

        fun preview(context: Context, spec: String, source: String) {
            val handler = Handler(contextMainLooper())
            val settings = kotlinx.coroutines.runBlocking { AppDataRepository.get(context).getTypedSettings() }
            parseVoiceAlertSound(spec)?.let { sound ->
                previewVoice(context, voiceAnnouncement(sound, null, null, percentAvailable = true, distanceUnit = settings.distanceUnit, temperatureUnit = settings.temperatureUnit), source)
                return
            }
            val tts = parseTtsAlertSound(spec)
            if (tts != null) {
                val text = renderAlertMessageTemplate(tts.text, ttsSampleAlert(spec), batteryPercent = 42.0, distanceUnit = settings.distanceUnit)
                if (text.isEmpty()) return
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
            previewClip(context, handler, settings.soundPack, previewSlot(spec), mySoundId(spec), source)
        }

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
 * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `alertAudioLatencyReportMs`
 */
internal const val ALERT_AUDIO_LATENCY_REPORT_MS = 150L
