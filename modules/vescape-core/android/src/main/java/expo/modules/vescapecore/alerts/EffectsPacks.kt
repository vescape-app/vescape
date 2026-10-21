package expo.modules.vescapecore.alerts

import android.content.Context
import android.media.MediaMetadataRetriever
import org.json.JSONObject

/**
 * Built-in effects packs (`shared/alerts/packs/effects-<id>`): every pack fills the required slots
 * of `scripts/alert-packs/catalog.json` (positive/info/warning/critical sounds, geiger ticks) and
 * may fill the optional cue slots ([OPTIONAL_SLOT_FALLBACK]). The `soundPack`
 * setting names one of them; My sounds overrides ([SOUND_OVERRIDE_SLOTS]) win over its slots.
 *
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift
 * @parity /src/modules/settings/lib/appSounds.ts `EFFECTS_PACKS`
 */
internal val EFFECTS_PACK_IDS = listOf("retro", "simple", "hev", "clean")

/** Pack standing in for an unknown id. */
internal const val EFFECTS_PACK_FALLBACK = "simple"

internal fun effectsPackId(pack: String): String = if (pack in EFFECTS_PACK_IDS) pack else EFFECTS_PACK_FALLBACK

/**
 * Optional effects slot → the required slot a pack that leaves it out plays instead.
 *
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `optionalSlotFallback`
 * @parity /scripts/alert-packs/catalog.json `optionalEffectSlots`
 */
internal val OPTIONAL_SLOT_FALLBACK = mapOf(
    "cue.on" to "severity.positive",
    "cue.off" to "severity.warning",
    "cue.ride.end" to "severity.info",
    "cue.groupRide.created" to "severity.positive",
    "cue.groupRide.joined" to "severity.positive",
)

/**
 * Group Ride events with an app cue and a line under the same key in every voice pack.
 *
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `groupRideCues`
 * @parity /modules/vescape-core/src/index.ts `AppSoundCueId`
 */
internal val GROUP_RIDE_CUES = listOf(
    "groupRide.created",
    "groupRide.joined",
    "groupRide.riderJoined",
    "groupRide.riderLeft",
    "groupRide.lost",
    "groupRide.restored",
)

/**
 * App cue id (the `playAppCue` cue names) → effects slot. Error and the rider and link Group Ride
 * events have no slot of their own and play a fixed severity sound.
 *
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `appCueSlot`
 * @parity /modules/vescape-core/src/index.ts `AppSoundCueId`
 */
internal fun appCueSlot(cue: String): String? = when (cue) {
    "on" -> "cue.on"
    "off" -> "cue.off"
    "error" -> "severity.critical"
    "ride.end" -> "cue.ride.end"
    "groupRide.created", "groupRide.joined" -> "cue.$cue"
    "groupRide.riderJoined" -> "severity.info"
    "groupRide.riderLeft", "groupRide.lost" -> "severity.warning"
    "groupRide.restored" -> "severity.positive"
    else -> null
}

/**
 * Voice key app cue [cue] speaks after its effect at Voice level `full`.
 *
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `appCueVoiceKey`
 */
internal fun appCueVoiceKey(cue: String): String? = when (cue) {
    "on" -> "link.connected"
    "off" -> "link.lost"
    "error" -> "system.error"
    "ride.end" -> "ride.end"
    in GROUP_RIDE_CUES -> cue
    else -> null
}

/**
 * Slot a one-shot preview of [spec] plays: a geiger tick, or the severity sound once.
 *
 * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `previewSlot`
 */
internal fun previewSlot(spec: String): String =
    if (isGeigerSpec(spec)) geigerSlot(spec) else parseSlotAlertSound(spec).severity.slot

/**
 * Slot whose clip [slot] plays: [slot] itself when it has a My sound override or the pack fills it,
 * else the same lookup for its [OPTIONAL_SLOT_FALLBACK] slot. An override on the fallback slot so
 * also covers optional cues the pack leaves out.
 *
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `lookupSlot`
 */
internal fun lookupSlot(slot: String, hasOverride: (String) -> Boolean, packHas: (String) -> Boolean): String {
    if (hasOverride(slot) || packHas(slot)) return slot
    return OPTIONAL_SLOT_FALLBACK[slot]?.let { lookupSlot(it, hasOverride, packHas) } ?: slot
}

/** Where a slot plays from: a My sound file, or a built-in pack clip at an asset path. */
internal sealed interface SlotClip {
    data class Mine(val file: java.io.File) : SlotClip
    data class Asset(val path: String) : SlotClip
}

/**
 * Clip [slot] plays: My sound [my] when it still exists, else the override or [pack] clip of the
 * slot [lookupSlot] picks. A missing My sound falls back to the pack, never silence.
 *
 * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `clipKey`
 */
internal fun slotClip(context: Context, pack: String, slot: String, my: String? = null): SlotClip? {
    my?.let { MySounds.file(context, it) }?.let { return SlotClip.Mine(it) }
    val target = lookupSlot(slot, { MySounds.overrideFile(context, it) != null }) { EffectsPackAssets.has(context, pack, it) }
    return MySounds.overrideFile(context, target)?.let(SlotClip::Mine)
        ?: EffectsPackAssets.path(context, pack, target)?.let(SlotClip::Asset)
}

/** Length of the clip, 0 when unreadable. */
internal fun SlotClip.durationMs(context: Context): Long = when (this) {
    is SlotClip.Mine -> MySounds.durationMs(file)
    is SlotClip.Asset -> EffectsPackAssets.durationMs(context, path)
}

/**
 * Asset paths of every built-in pack's own slots, `"<pack>/<slot>"` → asset path. Read once.
 */
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

    /** [pack]'s own slot standing in for [slot], overrides aside (see [lookupSlot]). */
    fun packSlot(context: Context, pack: String, slot: String): String = lookupSlot(slot, { false }) { has(context, pack, it) }

    /** Asset path of [pack]'s clip for [slot], through its optional-slot fallback. */
    fun path(context: Context, pack: String, slot: String): String? =
        slots(context)["${effectsPackId(pack)}/${packSlot(context, pack, slot)}"]

    @Volatile private var voices: Map<String, String?>? = null

    /** Voice pack [pack]'s manifest names for the `matching` voice, null when it names none. */
    fun voice(context: Context, pack: String): String? = (voices ?: synchronized(this) {
        voices ?: EFFECTS_PACK_IDS.associateWith { id ->
            context.assets.open("$ROOT/effects-$id/pack.json").bufferedReader()
                .use { JSONObject(it.readText()) }.optString("voice").ifEmpty { null }
        }.also { voices = it }
    })[effectsPackId(pack)]

    private val durations = java.util.concurrent.ConcurrentHashMap<String, Long>()

    /** Length of [slot] in [pack], 0 when unreadable. */
    fun durationMs(context: Context, pack: String, slot: String): Long =
        path(context, pack, slot)?.let { durationMs(context, it) } ?: 0L

    /** Length of the clip at asset [path], 0 when unreadable. Read once per clip. */
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
