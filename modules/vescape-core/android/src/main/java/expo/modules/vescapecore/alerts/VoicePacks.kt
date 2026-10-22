package expo.modules.vescapecore.alerts

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import expo.modules.vescapecore.diagnostics.UnexpectedNativeError
import org.json.JSONObject
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Built-in voice packs (`shared/alerts/packs/voice-<id>`): whole-sentence lines per message key plus
 * value clips, joined natively into one buffer after the effects pack's severity sound.
 *
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift
 * @parity /src/modules/settings/lib/appSounds.ts `VOICE_PACKS`
 */
internal val VOICE_PACK_IDS = listOf("nova", "radio", "nicole")

/** Former voice id → its new id; a saved one reads as the renamed voice. */
internal val RENAMED_VOICE_PACK_IDS = mapOf("clean" to "nova", "hev" to "radio")

/** Voice an effects pack without its own voice matches, and the stand-in for an unknown id. */
internal const val VOICE_PACK_FALLBACK = "nova"

/** `voice` setting that follows the voice the selected effects pack names. */
internal const val VOICE_MATCHING = "matching"

/**
 * Voice level: `off` plays effects only for presets and app sounds; `minimal` and `standard` speak
 * preset alerts; `full` also speaks app cues and group ride events (#581). Each level also picks the
 * wording ([VoiceWording]). Custom rules speak whatever the level, `off` with standard wording.
 *
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voiceLevels`
 * @parity /src/modules/settings/lib/appSounds.ts `VOICE_LEVELS`
 */
internal val VOICE_LEVELS = listOf("off", "minimal", "standard", "full")
internal const val VOICE_LEVEL_DEFAULT = "standard"

/**
 * Voice pack the [voice] setting plays: a named pack, or the one effects pack [effectsVoice] names.
 *
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voicePackId`
 * @parity /src/modules/settings/lib/appSounds.ts `resolvedVoiceId`
 */
internal fun voicePackId(voice: String, effectsVoice: String?): String = when {
    voice in VOICE_PACK_IDS -> voice
    effectsVoice in VOICE_PACK_IDS -> effectsVoice!!
    else -> VOICE_PACK_FALLBACK
}

/**
 * Voice keys of built-in alerts and the value type a single-value alert on each speaks (null: no
 * value). Mirrors `scripts/alert-packs/catalog.json` `voiceKeys`. Multi-value lines (`weather.*`)
 * carry their types on each [VoiceValue] instead.
 *
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voiceKeyValueTypes`
 * @parity /src/modules/alerts/lib/alertSoundString.ts `VOICE_KEY_BY_CONTROL`
 */
internal val VOICE_KEY_VALUE_TYPES: Map<String, String?> = mapOf(
    "battery" to "percent",
    "motorTemp" to "degrees",
    "controllerTemp" to "degrees",
    "speed" to "number",
    "dutyCycle" to "number",
    "boardConnection.connected" to null,
    "boardConnection.lost" to null,
    "system.error" to null,
    "groupRide.created" to null,
    "groupRide.joined" to null,
    "groupRide.riderJoined" to null,
    "groupRide.riderLeft" to null,
    "groupRide.lost" to null,
    "groupRide.restored" to null,
    "ride.end" to null,
    "weather.rain" to null,
    "weather.rain.now" to null,
)

/**
 * Voice key an alert on [controlId] speaks; null for metrics without voice lines.
 *
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voiceKey`
 * @parity /src/modules/alerts/lib/alertSoundString.ts `VOICE_KEY_BY_CONTROL`
 */
internal fun voiceKey(controlId: String): String? = when (controlId) {
    "battery" -> "battery"
    "motor-temp" -> "motorTemp"
    "controller-temp" -> "controllerTemp"
    "speed" -> "speed"
    "duty" -> "dutyCycle"
    else -> null
}

private const val KM_PER_MILE = 1.609344

/**
 * Which phrases a line speaks: [MINIMAL] the generic line's `minimal` (else `start`), never a
 * severity line; [STANDARD] the severity line's `start`; [FULL] its `full` pool (else `start`) with
 * an ending drawn at `endChance`.
 *
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `VoiceWording`
 */
internal enum class VoiceWording {
    MINIMAL, STANDARD, FULL;

    companion object {
        fun of(level: String) = when (level) {
            "minimal" -> MINIMAL
            "full" -> FULL
            else -> STANDARD
        }
    }
}

/**
 * One value a line speaks: the clip [value] of value type [type] (`percent`, `degrees`, `number`,
 * `duration` in minutes). The voice layer plays that exact clip or skips it; mapping a raw reading
 * onto the pack's clip set is the caller's job.
 *
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `VoiceValue`
 */
internal data class VoiceValue(val type: String, val value: Int)

/**
 * One voice announcement: the severity sound, then the line for [key] with [values] spoken in order
 * after its start ("Rain" + "in two and a half hours" + "thirty percent").
 *
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `VoiceAnnouncement`
 */
internal data class VoiceAnnouncement(
    val severity: AlertSeverity,
    val key: String?,
    val values: List<VoiceValue> = emptyList(),
    val wording: VoiceWording = VoiceWording.STANDARD,
)

/**
 * What a `voice` sound says for an alert on [controlId]. The key comes from the sound string or the
 * metric; the value from the sound string or [reading] (percent for battery only while
 * [percentAvailable]: without a battery config a battery reading is volts), °C read in °F under
 * imperial units, km/h read in mph, rounded to the nearest clip. A null key plays the severity sound only.
 *
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voiceAnnouncement`
 */
internal fun voiceAnnouncement(
    sound: VoiceAlertSound,
    controlId: String?,
    reading: Double?,
    percentAvailable: Boolean,
    unitSystem: String,
): VoiceAnnouncement {
    val key = sound.key ?: controlId?.let(::voiceKey)
    val raw = sound.value ?: reading?.takeIf { key != "battery" || percentAvailable }
    val type = key?.let { VOICE_KEY_VALUE_TYPES[it] }
    val value = when (type) {
        "percent" -> raw
        "number" -> raw?.let { if (key == "speed" && unitSystem == "imperial") it / KM_PER_MILE else it }
        "degrees" -> raw?.let { if (unitSystem == "imperial") it * 9.0 / 5.0 + 32.0 else it }
        else -> null
    }
    val clip = value?.takeIf { it.isFinite() }?.roundToInt()
    return VoiceAnnouncement(sound.severity, key, listOfNotNull(type?.let { t -> clip?.let { VoiceValue(t, it) } }))
}

/**
 * A line in `pack.json`: `start` phrases, an optional `minimal` phrase set, and an optional `full`
 * pool whose ending plays at [endChance]. Each list holds clip variants.
 */
internal data class VoiceLine(
    val start: List<String>,
    val minimal: List<String> = emptyList(),
    val fullStart: List<String> = emptyList(),
    val fullEnd: List<String> = emptyList(),
    val endChance: Double = 1.0,
) {
    val files: List<String> get() = start + minimal + fullStart + fullEnd
}

/** What one announcement can say: `start` (+ values) (+ an `end` at [endChance]). */
internal data class VoicePhrases(val start: List<String>, val end: List<String>, val endChance: Double)

/** A voice pack's `pack.json`: lines per key, value clip per value type and number. */
internal class VoicePackManifest(val lines: Map<String, VoiceLine>, val values: Map<String, Map<Int, String>>) {
    /**
     * Phrases for [key] in [wording]: Minimal reads the generic `<key>` line only; Standard and Full
     * the most specific `<key>.<severity>`, else `<key>`. Null when the pack has no such line.
     */
    fun phrases(key: String, severity: AlertSeverity, wording: VoiceWording): VoicePhrases? {
        val line = (if (wording == VoiceWording.MINIMAL) lines[key] else lines["$key.${severity.id}"] ?: lines[key])
            ?: return null
        return when (wording) {
            VoiceWording.MINIMAL -> VoicePhrases(line.minimal.ifEmpty { line.start }, emptyList(), 0.0)
            VoiceWording.STANDARD -> VoicePhrases(line.start, emptyList(), 0.0)
            VoiceWording.FULL -> VoicePhrases(line.fullStart.ifEmpty { line.start }, line.fullEnd, line.endChance)
        }.takeIf { it.start.isNotEmpty() }
    }

    /** Clip for [value]; null when the pack has no such clip. */
    fun valueClip(value: VoiceValue): String? = values[value.type]?.get(value.value)

    companion object {
        fun parse(json: JSONObject): VoicePackManifest {
            val lines = json.getJSONObject("lines")
            val values = json.optJSONObject("values") ?: JSONObject()
            fun list(obj: JSONObject, name: String) = obj.optJSONArray(name)?.let { array -> (0 until array.length()).map(array::getString) }.orEmpty()
            return VoicePackManifest(
                lines = lines.keys().asSequence().associateWith { key ->
                    lines.getJSONObject(key).let { line ->
                        val full = line.optJSONObject("full") ?: JSONObject()
                        VoiceLine(
                            start = list(line, "start"),
                            minimal = list(line, "minimal"),
                            fullStart = list(full, "start"),
                            fullEnd = list(full, "end"),
                            endChance = full.optDouble("endChance", 1.0),
                        )
                    }
                },
                values = values.keys().asSequence().associateWith { type ->
                    val clips = values.getJSONObject(type)
                    clips.keys().asSequence().mapNotNull { n -> n.toIntOrNull()?.let { it to clips.getString(n) } }.toMap()
                },
            )
        }
    }
}

/**
 * Picks one clip per line part at random, never the same `start` twice in a row for a key, and
 * an `end` only at its `endChance`. The pick after each announcement is made right away, so [next]
 * lets the caller join it ahead.
 *
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `VoiceVariantPicker`
 */
internal class VoiceVariantPicker(private val random: (Int) -> Int = { kotlin.random.Random.nextInt(it) }) {
    private data class Choice(val start: Int, val end: Int?) {
        /** False for a pick made against another pack's line (the picker serves every pack). */
        fun fits(line: VoicePhrases) = start < line.start.size && (end?.let { it < line.end.size } ?: true)
    }

    private val upcoming = HashMap<String, Choice>()

    /**
     * Clip files of [announcement] in play order (start, values, end); null when [manifest] has no
     * line. A value without a clip is skipped; the rest of the line still plays.
     */
    @Synchronized
    fun clips(manifest: VoicePackManifest, announcement: VoiceAnnouncement): List<String>? {
        val (key, line) = resolve(manifest, announcement) ?: return null
        val lineKey = "$key.${announcement.severity.id}.${announcement.wording}"
        val choice = upcoming[lineKey]?.takeIf { it.fits(line) }
            ?: choose(line, avoid = null)
        upcoming[lineKey] = choose(line, avoid = choice.start)
        return files(manifest, line, choice, announcement.values)
    }

    /** Clip files the next [clips] call for [announcement] returns, without consuming the pick. */
    @Synchronized
    fun next(manifest: VoicePackManifest, announcement: VoiceAnnouncement): List<String>? {
        val (key, line) = resolve(manifest, announcement) ?: return null
        val choice = upcoming["$key.${announcement.severity.id}.${announcement.wording}"]?.takeIf { it.fits(line) } ?: return null
        return files(manifest, line, choice, announcement.values)
    }

    private fun resolve(manifest: VoicePackManifest, announcement: VoiceAnnouncement): Pair<String, VoicePhrases>? {
        val key = announcement.key ?: return null
        return manifest.phrases(key, announcement.severity, announcement.wording)?.let { key to it }
    }

    private fun choose(line: VoicePhrases, avoid: Int?): Choice {
        var start = random(line.start.size)
        if (line.start.size > 1 && start == avoid) start = (start + 1) % line.start.size
        val ends = line.end.isNotEmpty() && random(100) < (line.endChance * 100).roundToInt()
        return Choice(start, if (ends) random(line.end.size) else null)
    }

    private fun files(manifest: VoicePackManifest, line: VoicePhrases, choice: Choice, values: List<VoiceValue>) =
        listOf(line.start[choice.start]) + values.mapNotNull(manifest::valueClip) + listOfNotNull(choice.end?.let { line.end[it] })
}

/**
 * Leading AAC encoder priming and silence, at most [maxFrames]: joins must not open a gap before each
 * clip. Clips start on speech, so anything under [threshold] there is padding.
 *
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `leadingSilenceFrames`
 */
internal fun leadingSilenceFrames(samples: ShortArray, threshold: Int = VOICE_SILENCE_THRESHOLD, maxFrames: Int = VOICE_PRIMING_MAX_FRAMES): Int {
    val limit = minOf(samples.size, maxFrames)
    for (index in 0 until limit) if (abs(samples[index].toInt()) >= threshold) return index
    return limit
}

/** Amplitude (of 32 767) below which a clip's first samples count as padding. */
internal const val VOICE_SILENCE_THRESHOLD = 64

/** Longest padding trimmed: two AAC frames, about 93 ms at 22 050 Hz. */
internal const val VOICE_PRIMING_MAX_FRAMES = 2048

/** Mono 16-bit PCM. */
internal class VoicePcm(val samples: ShortArray, val sampleRate: Int) {
    val durationMs: Long get() = samples.size * 1000L / sampleRate
}

/** Voice pack manifests and decoded clips, read from the APK's `alert-packs/` assets once each. */
internal object VoicePackAssets {
    private const val ROOT = "alert-packs"
    private val manifests = ConcurrentHashMap<String, VoicePackManifest>()
    private val decoded = ConcurrentHashMap<String, VoicePcm>()
    val picker = VoiceVariantPicker()
    /** Next announcement's buffer per line, joined ahead: file list → PCM. */
    private val prepared = ConcurrentHashMap<String, Pair<List<String>, VoicePcm>>()
    private val preparer = java.util.concurrent.Executors.newSingleThreadExecutor { Thread(it, "voice-prepare").apply { isDaemon = true } }

    fun manifest(context: Context, pack: String): VoicePackManifest? {
        val id = if (pack in VOICE_PACK_IDS) pack else VOICE_PACK_FALLBACK
        manifests[id]?.let { return it }
        return try {
            context.assets.open("$ROOT/voice-$id/pack.json").bufferedReader().use { VoicePackManifest.parse(JSONObject(it.readText())) }
                .also { manifests[id] = it }
        } catch (e: Exception) {
            UnexpectedNativeError.report("alert_voice_manifest", "bundled_asset", e)
            null
        }
    }

    /** Decode every line clip of [pack] ahead of the first announcement. Value clips decode on use. */
    fun prewarm(context: Context, pack: String) {
        val manifest = manifest(context, pack) ?: return
        val id = if (pack in VOICE_PACK_IDS) pack else VOICE_PACK_FALLBACK
        manifest.lines.values.flatMap { it.files }.forEach { decode(context, id, it) }
    }

    /**
     * [announcement] joined into one buffer from [pack], or null when the pack has no line for its
     * key: the caller plays the severity sound only. A clip that cannot decode is left out.
     */
    fun join(context: Context, pack: String, announcement: VoiceAnnouncement): VoicePcm? {
        val id = if (pack in VOICE_PACK_IDS) pack else VOICE_PACK_FALLBACK
        val manifest = manifest(context, id) ?: return null
        val files = picker.clips(manifest, announcement) ?: return null
        val slot = "$id/${announcement.key}.${announcement.severity.id}.${announcement.wording}"
        val pcm = prepared.remove(slot)?.takeIf { it.first == files }?.second ?: concat(context, id, files)
        // The next pick joins now, so its variant costs the next announcement nothing.
        preparer.execute {
            val next = picker.next(manifest, announcement) ?: return@execute
            concat(context, id, next)?.let { prepared[slot] = next to it }
        }
        return pcm
    }

    private fun concat(context: Context, pack: String, files: List<String>): VoicePcm? {
        val clips = files.mapNotNull { decode(context, pack, it) }
        if (clips.isEmpty()) return null
        val rate = clips.first().sampleRate
        val joined = ShortArray(clips.sumOf { if (it.sampleRate == rate) it.samples.size else 0 })
        var offset = 0
        for (clip in clips) {
            if (clip.sampleRate != rate) continue
            clip.samples.copyInto(joined, offset)
            offset += clip.samples.size
        }
        return VoicePcm(joined, rate)
    }

    private fun decode(context: Context, pack: String, file: String): VoicePcm? {
        val path = "$ROOT/voice-$pack/$file"
        decoded[path]?.let { return it }
        return try {
            decodeAsset(context, path).also { decoded[path] = it }
        } catch (e: Exception) {
            UnexpectedNativeError.report("alert_voice_decode", "audio_decode_failed", e)
            null
        }
    }

    /** AAC asset → mono 16-bit PCM, first channel only, leading padding trimmed. */
    private fun decodeAsset(context: Context, path: String): VoicePcm {
        val extractor = MediaExtractor()
        try {
            context.assets.openFd(path).use { extractor.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
            val track = (0 until extractor.trackCount).first {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            }
            extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track)
            var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
            val out = java.io.ByteArrayOutputStream()
            try {
                codec.configure(format, null, null, 0)
                codec.start()
                val info = MediaCodec.BufferInfo()
                var inputDone = false
                while (true) {
                    if (!inputDone) {
                        val input = codec.dequeueInputBuffer(10_000)
                        if (input >= 0) {
                            val size = extractor.readSampleData(codec.getInputBuffer(input)!!, 0)
                            if (size < 0) {
                                codec.queueInputBuffer(input, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                inputDone = true
                            } else {
                                codec.queueInputBuffer(input, 0, size, extractor.sampleTime, 0)
                                extractor.advance()
                            }
                        }
                    }
                    val output = codec.dequeueOutputBuffer(info, 10_000)
                    if (output == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        sampleRate = codec.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channels = codec.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    } else if (output >= 0) {
                        val buffer = codec.getOutputBuffer(output)!!
                        buffer.position(info.offset)
                        buffer.limit(info.offset + info.size)
                        val chunk = ByteArray(info.size)
                        buffer.get(chunk)
                        out.write(chunk)
                        codec.releaseOutputBuffer(output, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                    }
                }
                codec.stop()
            } finally {
                codec.release()
            }
            val shorts = java.nio.ByteBuffer.wrap(out.toByteArray()).order(ByteOrder.nativeOrder()).asShortBuffer()
            val frames = ShortArray(shorts.remaining() / channels) { shorts.get(it * channels) }
            return VoicePcm(frames.copyOfRange(leadingSilenceFrames(frames), frames.size), sampleRate)
        } finally {
            extractor.release()
        }
    }
}
