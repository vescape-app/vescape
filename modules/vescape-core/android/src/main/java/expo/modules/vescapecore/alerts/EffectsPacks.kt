package expo.modules.vescapecore.alerts

import android.content.Context
import android.media.MediaMetadataRetriever
import org.json.JSONObject

/**
 * Built-in effects packs (`shared/alerts/packs/effects-<id>`): every pack fills every slot of
 * `scripts/alert-packs/catalog.json` — severity beeps, app cues, geiger ticks. The `soundPack`
 * setting names one of them, or a custom app sound pack whose cues override [EFFECTS_PACK_FALLBACK].
 *
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift
 * @parity /src/modules/settings/lib/appSounds.ts `EFFECTS_PACKS`
 */
internal val EFFECTS_PACK_IDS = listOf("retro", "simple", "hev", "clean")

/** Pack whose slots back a custom app sound pack or an unknown id. */
internal const val EFFECTS_PACK_FALLBACK = "simple"

internal fun effectsPackId(pack: String): String = if (pack in EFFECTS_PACK_IDS) pack else EFFECTS_PACK_FALLBACK

/**
 * App cue id (the custom app sound pack cue names) → effects slot.
 *
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `appCueSlot`
 * @parity /src/modules/settings/lib/appSounds.ts `APP_SOUND_CUES`
 */
internal fun appCueSlot(cue: String): String? = when (cue) {
    "on" -> "cue.on"
    "off" -> "cue.off"
    "error" -> "cue.error"
    "created" -> "cue.groupRide.created"
    "join" -> "cue.groupRide.joined"
    "ride.end" -> "cue.ride.end"
    else -> null
}

/**
 * Geiger slot for a range rule's `soundType`: today's tick names map onto the pack's soft/mid/hard
 * ticks; anything else ticks soft.
 *
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `geigerSlot`
 */
internal fun geigerSlot(soundType: String): String = when (soundType) {
    "preset:tick_hard" -> "geiger.mid"
    "preset:gamma", "preset:sustained" -> "geiger.hard"
    else -> "geiger.soft"
}

/** True for a `soundType` that names a geiger tick rather than a single alert sound. */
internal fun isGeigerSoundType(soundType: String): Boolean =
    soundType in setOf("preset:tick", "preset:tick_hard", "preset:gamma", "preset:sustained")

/**
 * Slot a one-shot preview of [soundType] plays: a geiger tick, or the severity sound once.
 *
 * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `previewSlot`
 */
internal fun previewSlot(soundType: String): String =
    if (isGeigerSoundType(soundType)) geigerSlot(soundType) else parseSlotAlertSound(soundType).severity.slot

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
