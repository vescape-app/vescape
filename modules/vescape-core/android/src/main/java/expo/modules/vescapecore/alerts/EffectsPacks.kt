package expo.modules.vescapecore.alerts

import android.content.Context
import android.media.MediaMetadataRetriever
import org.json.JSONObject

/**
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift
 * @parity /src/modules/settings/lib/appSounds.ts `EFFECTS_PACKS`
 */
internal val EFFECTS_PACK_IDS = listOf("arc", "pulse", "hev")

internal const val EFFECTS_PACK_FALLBACK = "arc"

internal val RETIRED_EFFECTS_PACK_IDS = setOf("retro", "simple")

internal val RENAMED_EFFECTS_PACK_IDS = mapOf("clean" to "pulse")

internal fun effectsPackId(pack: String): String = if (pack in EFFECTS_PACK_IDS) pack else EFFECTS_PACK_FALLBACK

/**
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `optionalSlotFallback`
 */
internal val OPTIONAL_SLOT_FALLBACK = mapOf(
    "cue.on" to "severity.positive",
    "cue.off" to "severity.warning",
    "cue.ride.end" to "severity.info",
    "cue.groupRide.created" to "severity.positive",
    "cue.groupRide.joined" to "severity.positive",
)

/**
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `groupRideCues`
 */
internal val GROUP_RIDE_CUES = listOf(
    "groupRide.created",
    "groupRide.joined",
    "groupRide.riderJoined",
    "groupRide.riderLeft",
    "groupRide.lost",
    "groupRide.restored",
    "groupRide.signal.down",
    "groupRide.signal.minor",
    "groupRide.signal.serious",
    "groupRide.signal.battery",
    "groupRide.signal.tire",
    "groupRide.signal.overheat",
    "groupRide.signal.board",
    "groupRide.signal.wait",
    "groupRide.signal.break",
    "groupRide.signal.ok",
    "groupRide.signal.sent",
    "groupRide.signal.cleared",
    "groupRide.hazard.water",
    "groupRide.hazard.terrain",
    "groupRide.hazard.obstacle",
    "groupRide.hazard.police",
    "groupRide.hazard.sent",
)

/**
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `appCueSlot`
 */
internal fun appCueSlot(cue: String): String? = when (cue) {
    "on" -> "cue.on"
    "off" -> "cue.off"
    "error" -> "severity.critical"
    "ride.end" -> "cue.ride.end"
    "groupRide.created", "groupRide.joined" -> "cue.$cue"
    "groupRide.riderJoined", "groupRide.signal.sent", "groupRide.hazard.sent", "groupRide.signal.down",
    "groupRide.signal.wait", "groupRide.signal.break" -> "severity.info"
    "groupRide.riderLeft", "groupRide.lost" -> "severity.warning"
    "groupRide.restored", "groupRide.signal.ok", "groupRide.signal.cleared" -> "severity.positive"
    "groupRide.signal.serious" -> "severity.critical"
    "groupRide.signal.minor", "groupRide.signal.battery", "groupRide.signal.tire", "groupRide.signal.overheat", "groupRide.signal.board" ->
        "severity.warning"
    "groupRide.hazard.water", "groupRide.hazard.terrain", "groupRide.hazard.obstacle", "groupRide.hazard.police" ->
        "severity.warning"
    else -> null
}

/**
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `appCueVoiceKey`
 */
internal fun appCueVoiceKey(cue: String): String? = when (cue) {
    "on" -> "boardConnection.connected"
    "off" -> "boardConnection.lost"
    "error" -> "system.error"
    "ride.end" -> "ride.end"
    in GROUP_RIDE_CUES -> cue
    else -> null
}

/**
 * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `previewSlot`
 */
internal fun previewSlot(spec: String): String =
    if (isGeigerSpec(spec)) geigerSlot(spec) else parseSlotAlertSound(spec).severity.slot

/**
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `lookupSlot`
 */
internal fun lookupSlot(slot: String, hasOverride: (String) -> Boolean, packHas: (String) -> Boolean): String {
    if (hasOverride(slot) || packHas(slot)) return slot
    return OPTIONAL_SLOT_FALLBACK[slot]?.let { lookupSlot(it, hasOverride, packHas) } ?: slot
}

internal sealed interface SlotClip {
    data class Mine(val file: java.io.File) : SlotClip
    data class Asset(val path: String) : SlotClip
}

/**
 * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `clipKey`
 */
internal fun slotClip(context: Context, pack: String, slot: String, my: String? = null): SlotClip? {
    my?.let { MySounds.file(context, it) }?.let { return SlotClip.Mine(it) }
    val target = lookupSlot(slot, { MySounds.overrideFile(context, it) != null }) { EffectsPackAssets.has(context, pack, it) }
    return MySounds.overrideFile(context, target)?.let(SlotClip::Mine)
        ?: EffectsPackAssets.path(context, pack, target)?.let(SlotClip::Asset)
}

internal fun SlotClip.durationMs(context: Context): Long = when (this) {
    is SlotClip.Mine -> MySounds.durationMs(file)
    is SlotClip.Asset -> EffectsPackAssets.durationMs(context, path)
}

internal object EffectsPackAssets {
    private const val ROOT = "alert-packs"

    @Volatile private var cached: Map<String, String>? = null

    fun slots(context: Context): Map<String, String> = cached ?: synchronized(this) {
        cached ?: EFFECTS_PACK_IDS.flatMap { pack ->
            val dir = "$ROOT/effects-$pack"
            val manifest = context.assets.open("$dir/pack.json").bufferedReader().use { JSONObject(it.readText()) }
            val slots = manifest.getJSONObject("slots")
            slots.keys().asSequence().map { "$pack/$it" to "$dir/${slots.getString(it)}" }.toList()
        }.toMap().also { cached = it }
    }

    fun has(context: Context, pack: String, slot: String): Boolean = "${effectsPackId(pack)}/$slot" in slots(context)

    fun packSlot(context: Context, pack: String, slot: String): String = lookupSlot(slot, { false }) { has(context, pack, it) }

    fun path(context: Context, pack: String, slot: String): String? =
        slots(context)["${effectsPackId(pack)}/${packSlot(context, pack, slot)}"]

    @Volatile private var voices: Map<String, String?>? = null

    fun voice(context: Context, pack: String): String? = (voices ?: synchronized(this) {
        voices ?: EFFECTS_PACK_IDS.associateWith { id ->
            context.assets.open("$ROOT/effects-$id/pack.json").bufferedReader()
                .use { JSONObject(it.readText()) }.optString("voice").ifEmpty { null }
        }.also { voices = it }
    })[effectsPackId(pack)]

    private val durations = java.util.concurrent.ConcurrentHashMap<String, Long>()

    fun durationMs(context: Context, pack: String, slot: String): Long =
        path(context, pack, slot)?.let { durationMs(context, it) } ?: 0L

    fun durationMs(context: Context, path: String): Long {
        return durations.getOrPut(path) {
            // intentional-suppression: an unreadable length only falls back to the minimum speech delay
            runCatching {
                context.assets.openFd(path).use { fd ->
                    MediaMetadataRetriever().run {
                        try {
                            setDataSource(fd.fileDescriptor, fd.startOffset, fd.length)
                            extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
                        } finally { release() }
                    }
                }
            }.getOrDefault(0L)
        }
    }
}
