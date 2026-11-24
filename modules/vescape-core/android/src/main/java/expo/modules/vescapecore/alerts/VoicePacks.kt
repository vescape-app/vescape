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
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift
 * @parity /src/modules/settings/lib/appSounds.ts `VOICE_PACKS`
 */
internal val VOICE_PACK_IDS = listOf("nova", "radio", "nicole")

internal val RENAMED_VOICE_PACK_IDS = mapOf("clean" to "nova", "hev" to "radio")

internal const val VOICE_PACK_FALLBACK = "nova"

internal const val VOICE_MATCHING = "matching"

/**
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voiceLevels`
 * @parity /src/modules/settings/lib/appSounds.ts `VOICE_LEVELS`
 */
internal val VOICE_LEVELS = listOf("off", "minimal", "standard", "full")
internal const val VOICE_LEVEL_DEFAULT = "standard"

/**
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voicePackId`
 * @parity /src/modules/settings/lib/appSounds.ts `resolvedVoiceId`
 */
internal fun voicePackId(voice: String, effectsVoice: String?): String = when {
    voice in VOICE_PACK_IDS -> voice
    effectsVoice in VOICE_PACK_IDS -> effectsVoice!!
    else -> VOICE_PACK_FALLBACK
}

/**
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
    "groupRide.signal.down" to null,
    "groupRide.signal.minor" to null,
    "groupRide.signal.serious" to null,
    "groupRide.signal.battery" to null,
    "groupRide.signal.tire" to null,
    "groupRide.signal.overheat" to null,
    "groupRide.signal.board" to null,
    "groupRide.signal.wait" to null,
    "groupRide.signal.break" to null,
    "groupRide.signal.ok" to null,
    "groupRide.signal.sent" to null,
    "groupRide.signal.cleared" to null,
    "groupRide.hazard.water" to null,
    "groupRide.hazard.terrain" to null,
    "groupRide.hazard.obstacle" to null,
    "groupRide.hazard.police" to null,
    "groupRide.hazard.sent" to null,
    "ride.end" to null,
    "weather.storm" to null,
    "weather.storm.now" to null,
    "weather.wind" to null,
    "weather.wind.now" to null,
    "weather.rain" to null,
    "weather.rain.now" to null,
    "voice.intro" to null,
)

/**
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
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `VoiceValue`
 */
internal data class VoiceValue(val type: String, val value: Int)

/**
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `VoiceAnnouncement`
 */
internal data class VoiceAnnouncement(
    val severity: AlertSeverity,
    val key: String?,
    val values: List<VoiceValue> = emptyList(),
    val wording: VoiceWording = VoiceWording.STANDARD,
)

/**
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voiceAnnouncement`
 */
internal fun voiceAnnouncement(
    sound: VoiceAlertSound,
    controlId: String?,
    reading: Double?,
    percentAvailable: Boolean,
    distanceUnit: String,
    temperatureUnit: String,
): VoiceAnnouncement {
    val key = sound.key ?: controlId?.let(::voiceKey)
    val raw = sound.value ?: reading?.takeIf { key != "battery" || percentAvailable }
    val type = key?.let { VOICE_KEY_VALUE_TYPES[it] }
    val value = when (type) {
        "percent" -> raw
        "number" -> raw?.let { if (key == "speed" && distanceUnit == "mi") it / KM_PER_MILE else it }
        "degrees" -> raw?.let { if (temperatureUnit == "fahrenheit") it * 9.0 / 5.0 + 32.0 else it }
        else -> null
    }
    val clip = value?.takeIf { it.isFinite() }?.roundToInt()
    return VoiceAnnouncement(sound.severity, key, listOfNotNull(type?.let { t -> clip?.let { VoiceValue(t, it) } }))
}

internal data class VoiceLine(
    val start: List<String>,
    val minimal: List<String> = emptyList(),
    val fullStart: List<String> = emptyList(),
    val fullEnd: List<String> = emptyList(),
    val endChance: Double = 1.0,
    val fullRare: List<String> = emptyList(),
    val rareChance: Double = 0.0,
) {
    val files: List<String> get() = start + minimal + fullStart + fullEnd + fullRare
}

internal data class VoicePhrases(
    val start: List<String>,
    val end: List<String>,
    val endChance: Double,
    val rare: List<String> = emptyList(),
    val rareChance: Double = 0.0,
)

internal class VoicePackManifest(val lines: Map<String, VoiceLine>, val values: Map<String, Map<Int, String>>) {
    fun phrases(key: String, severity: AlertSeverity, wording: VoiceWording): VoicePhrases? {
        val line = (if (wording == VoiceWording.MINIMAL) lines[key] else lines["$key.${severity.id}"] ?: lines[key])
            ?: return null
        return when (wording) {
            VoiceWording.MINIMAL -> VoicePhrases(line.minimal.ifEmpty { line.start }, emptyList(), 0.0)
            VoiceWording.STANDARD -> VoicePhrases(line.start, emptyList(), 0.0)
            VoiceWording.FULL -> VoicePhrases(
                line.fullStart.ifEmpty { line.start },
                line.fullEnd,
                line.endChance,
                line.fullRare,
                line.rareChance,
            )
        }.takeIf { it.start.isNotEmpty() }
    }

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
                            fullRare = list(full, "rare"),
                            rareChance = full.optDouble("rareChance", 0.0),
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
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `VoiceVariantPicker`
 */
internal class VoiceVariantPicker(private val random: (Int) -> Int = { kotlin.random.Random.nextInt(it) }) {
    private data class Choice(val start: Int, val isRare: Boolean, val end: Int?) {
        fun fits(line: VoicePhrases): Boolean {
            val headFits = if (isRare) start < line.rare.size else start < line.start.size
            return headFits && (end?.let { it < line.end.size } ?: true)
        }
    }

    private val upcoming = HashMap<String, Choice>()

    @Synchronized
    fun clips(manifest: VoicePackManifest, announcement: VoiceAnnouncement): List<String>? {
        val (key, line) = resolve(manifest, announcement) ?: return null
        val lineKey = "$key.${announcement.severity.id}.${announcement.wording}"
        val choice = upcoming[lineKey]?.takeIf { it.fits(line) }
            ?: choose(line, avoid = null)
        upcoming[lineKey] = choose(line, avoid = if (choice.isRare) null else choice.start)
        return files(manifest, line, choice, announcement.values)
    }

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
        if (line.rare.isNotEmpty() && random(100) < (line.rareChance * 100).roundToInt()) {
            return Choice(random(line.rare.size), isRare = true, end = null)
        }
        var start = random(line.start.size)
        if (line.start.size > 1 && start == avoid) start = (start + 1) % line.start.size
        val ends = line.end.isNotEmpty() && random(100) < (line.endChance * 100).roundToInt()
        return Choice(start, isRare = false, end = if (ends) random(line.end.size) else null)
    }

    private fun files(manifest: VoicePackManifest, line: VoicePhrases, choice: Choice, values: List<VoiceValue>): List<String> {
        val head = if (choice.isRare) line.rare[choice.start] else line.start[choice.start]
        return listOf(head) + values.mapNotNull(manifest::valueClip) + listOfNotNull(choice.end?.let { line.end[it] })
    }
}

/**
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `leadingSilenceFrames`
 */
internal fun leadingSilenceFrames(samples: ShortArray, threshold: Int = VOICE_SILENCE_THRESHOLD, maxFrames: Int = VOICE_PRIMING_MAX_FRAMES): Int {
    val limit = minOf(samples.size, maxFrames)
    for (index in 0 until limit) if (abs(samples[index].toInt()) >= threshold) return index
    return limit
}

internal const val VOICE_SILENCE_THRESHOLD = 64

internal const val VOICE_PRIMING_MAX_FRAMES = 2048

internal class VoicePcm(val samples: ShortArray, val sampleRate: Int) {
    val durationMs: Long get() = samples.size * 1000L / sampleRate
}

internal object VoicePackAssets {
    private const val ROOT = "alert-packs"
    private val manifests = ConcurrentHashMap<String, VoicePackManifest>()
    private val decoded = ConcurrentHashMap<String, VoicePcm>()
    val picker = VoiceVariantPicker()
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

    fun prewarm(context: Context, pack: String) {
        val manifest = manifest(context, pack) ?: return
        val id = if (pack in VOICE_PACK_IDS) pack else VOICE_PACK_FALLBACK
        manifest.lines.values.flatMap { it.files }.forEach { decode(context, id, it) }
    }

    fun join(context: Context, pack: String, announcement: VoiceAnnouncement): VoicePcm? {
        val id = if (pack in VOICE_PACK_IDS) pack else VOICE_PACK_FALLBACK
        val manifest = manifest(context, id) ?: return null
        val files = picker.clips(manifest, announcement) ?: return null
        val slot = "$id/${announcement.key}.${announcement.severity.id}.${announcement.wording}"
        val pcm = prepared.remove(slot)?.takeIf { it.first == files }?.second ?: concat(context, id, files)
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
