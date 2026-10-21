package expo.modules.vescapecore.alerts

import android.content.Context
import android.media.MediaMetadataRetriever
import org.json.JSONObject

/**
 * Built-in effects packs (`shared/alerts/packs/effects-<id>`): every pack fills every slot of
 * `scripts/alert-packs/catalog.json` — severity beeps, app cues, geiger ticks. The `soundPack`
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
 * Group Ride events with their own app cue, each `cue.<event>` in every effects pack and a line
 * under the same key in every voice pack.
 *
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `groupRideCues`
 * @parity /src/modules/settings/lib/appSounds.ts `APP_SOUND_CUES`
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
 * App cue id (the `playAppSound` / `playAppCue` cue names) → effects slot.
 *
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `appCueSlot`
 * @parity /src/modules/settings/lib/appSounds.ts `APP_SOUND_CUES`
 */
internal fun appCueSlot(cue: String): String? = when (cue) {
    "on" -> "cue.on"
    "off" -> "cue.off"
    "error" -> "cue.error"
    "ride.end" -> "cue.ride.end"
    in GROUP_RIDE_CUES -> "cue.$cue"
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
 * Slot a one-shot preview of [soundType] plays: a geiger tick, or the severity sound once.
 *
 * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `previewSlot`
 */
internal fun previewSlot(soundType: String): String =
    if (isGeigerSoundType(soundType)) geigerSlot(soundType) else parseSlotAlertSound(soundType).severity.slot

/** Where a slot plays from: a My sound file, or a built-in pack clip at an asset path. */
internal sealed interface SlotClip {
    data class Mine(val file: java.io.File) : SlotClip
    data class Asset(val path: String) : SlotClip
}

/**
 * Clip [slot] plays: My sound [my] when it still exists, else the slot's override, else [pack]'s
 * clip. A missing My sound falls back to the pack, never silence.
 *
 * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `clipKey`
 */
internal fun slotClip(context: Context, pack: String, slot: String, my: String? = null): SlotClip? =
    (my?.let { MySounds.file(context, it) } ?: MySounds.overrideFile(context, slot))?.let(SlotClip::Mine)
        ?: EffectsPackAssets.path(context, pack, slot)?.let(SlotClip::Asset)

/** Length of the clip, 0 when unreadable. */
internal fun SlotClip.durationMs(context: Context): Long = when (this) {
    is SlotClip.Mine -> MySounds.durationMs(file)
    is SlotClip.Asset -> EffectsPackAssets.durationMs(context, path)
}

/** Asset paths of every built-in pack's slots, `"<pack>/<slot>"` → asset path. Read once. */
internal object EffectsPackAssets {
    private const val ROOT = "alert-packs"

    @Volatile private var cached: Map<String, String>? = null

    fun slots(context: Context): Map<String, String> = cached ?: synchronized(this) {
        cached ?: EFFECTS_PACK_IDS.flatMap { pack ->
            val dir = "$ROOT/effects-$pack"
            val manifest = context.assets.open("$dir/pack.json").bufferedReader().use { JSONObject(it.readText()) }
            val slots = manifest.getJSONObject("slots")
            slots.keys().asSequence().map { slot -> "$pack/$slot" to "$dir/${slots.getString(slot)}" }.toList()
        }.toMap().also { cached = it }
    }

    fun path(context: Context, pack: String, slot: String): String? = slots(context)["${effectsPackId(pack)}/$slot"]

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
