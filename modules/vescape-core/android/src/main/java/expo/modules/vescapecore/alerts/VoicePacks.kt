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
internal val VOICE_PACK_IDS = listOf("hev", "clean")

/** Voice an effects pack without its own voice matches, and the stand-in for an unknown id. */
internal const val VOICE_PACK_FALLBACK = "clean"

/** `voice` setting that follows the voice the selected effects pack names. */
internal const val VOICE_MATCHING = "matching"

/**
 * Voice level: `off` plays effects only for presets and app sounds, `standard` speaks preset alerts,
 * `full` also speaks app cues and group ride events (#581). Custom rules ignore it.
 *
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voiceLevels`
 * @parity /src/modules/settings/lib/appSounds.ts `VOICE_LEVELS`
 */
internal val VOICE_LEVELS = listOf("off", "standard", "full")
internal const val VOICE_LEVEL_DEFAULT = "standard"

/** Voice pack the [voice] setting plays: a named pack, or the one effects pack [effectsVoice] names. */
internal fun voicePackId(voice: String, effectsVoice: String?): String = when {
    voice in VOICE_PACK_IDS -> voice
    effectsVoice in VOICE_PACK_IDS -> effectsVoice!!
    else -> VOICE_PACK_FALLBACK
}

/**
 * Voice keys of built-in alerts and the value type each speaks (null: no value). Mirrors
 * `scripts/alert-packs/catalog.json` `voiceKeys`.
 *
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voiceKeyValueTypes`
 * @parity /src/modules/alerts/lib/alertSoundString.ts `VOICE_KEY_BY_CONTROL`
 */
internal val VOICE_KEY_VALUE_TYPES: Map<String, String?> = mapOf(
    "battery" to "percent",
    "motorTemp" to "degrees",
    "controllerTemp" to "degrees",
    "link.connected" to null,
    "link.lost" to null,
    "system.error" to null,
    "groupRide.created" to null,
    "groupRide.joined" to null,
    "ride.end" to null,
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
    else -> null
}

/** One voice announcement: the severity sound, then the line for [key] with [value] spoken last. */
internal data class VoiceAnnouncement(val severity: AlertSeverity, val key: String?, val value: Int?)

/**
 * What a `voice` sound says for an alert on [controlId]. The key comes from the sound string or the
 * metric; the value from the sound string or [threshold] (percent for battery only while
 * [percentAvailable]: without a battery config a battery threshold is volts), °C read in °F under
 * imperial units, rounded to the nearest clip. A null key plays the severity sound only.
 *
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voiceAnnouncement`
 */
internal fun voiceAnnouncement(
    sound: VoiceAlertSound,
    controlId: String?,
    threshold: Double?,
    percentAvailable: Boolean,
    unitSystem: String,
): VoiceAnnouncement {
    val key = sound.key ?: controlId?.let(::voiceKey)
    val raw = sound.value ?: threshold?.takeIf { key != "battery" || percentAvailable }
    val value = when (key?.let { VOICE_KEY_VALUE_TYPES[it] }) {
        "percent" -> raw
        "degrees" -> raw?.let { if (unitSystem == "imperial") it * 9.0 / 5.0 + 32.0 else it }
        else -> null
    }
    return VoiceAnnouncement(sound.severity, key, value?.takeIf { it.isFinite() }?.roundToInt())
}

/** A line: `start` (+ value) (+ `end`); each part lists clip variants, `end` may be empty. */
internal data class VoiceLine(val start: List<String>, val end: List<String>)

/** A voice pack's `pack.json`: lines per key, value clip per value type and number. */
internal class VoicePackManifest(val lines: Map<String, VoiceLine>, val values: Map<String, Map<Int, String>>) {
    /** Most specific line: `<key>.<severity>`, else the generic `<key>`; null when the pack has neither. */
    fun line(key: String, severity: AlertSeverity): VoiceLine? = lines["$key.${severity.id}"] ?: lines[key]

    /** Value clip of [key]'s value type for [value]; null when the pack has no such clip. */
    fun valueClip(key: String, value: Int): String? = VOICE_KEY_VALUE_TYPES[key]?.let { values[it]?.get(value) }

    companion object {
        fun parse(json: JSONObject): VoicePackManifest {
            val lines = json.getJSONObject("lines")
            val values = json.optJSONObject("values") ?: JSONObject()
            fun list(obj: JSONObject, name: String) = obj.optJSONArray(name)?.let { array -> (0 until array.length()).map(array::getString) }.orEmpty()
            return VoicePackManifest(
                lines = lines.keys().asSequence().associateWith { key ->
                    lines.getJSONObject(key).let { VoiceLine(list(it, "start"), list(it, "end")) }
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
 * Picks one clip per line part at random, never the same `start` twice in a row for a key.
 *
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `VoiceVariantPicker`
 */
internal class VoiceVariantPicker(private val random: (Int) -> Int = { kotlin.random.Random.nextInt(it) }) {
    private val lastStart = HashMap<String, Int>()

    /** Clip files of [announcement] in play order (start, value, end); null when [manifest] has no line. */
    @Synchronized
    fun clips(manifest: VoicePackManifest, announcement: VoiceAnnouncement): List<String>? {
        val key = announcement.key ?: return null
        val line = manifest.line(key, announcement.severity)?.takeIf { it.start.isNotEmpty() } ?: return null
        val lineKey = "$key.${announcement.severity.id}"
        var start = random(line.start.size)
        if (line.start.size > 1 && start == lastStart[lineKey]) start = (start + 1) % line.start.size
        lastStart[lineKey] = start
        return listOfNotNull(
            line.start[start],
            announcement.value?.let { manifest.valueClip(key, it) },
            line.end.takeIf { it.isNotEmpty() }?.let { it[random(it.size)] },
        )
    }
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
        manifest.lines.values.flatMap { it.start + it.end }.forEach { decode(context, id, it) }
    }

    /**
     * [announcement] joined into one buffer from [pack], or null when the pack has no line for its
     * key: the caller plays the severity sound only. A clip that cannot decode is left out.
     */
    fun join(context: Context, pack: String, announcement: VoiceAnnouncement): VoicePcm? {
        val id = if (pack in VOICE_PACK_IDS) pack else VOICE_PACK_FALLBACK
        val manifest = manifest(context, id) ?: return null
        val clips = picker.clips(manifest, announcement)?.mapNotNull { decode(context, id, it) } ?: return null
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
