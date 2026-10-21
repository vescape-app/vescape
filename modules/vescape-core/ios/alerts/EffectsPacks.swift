import Foundation

/// Built-in effects packs (`shared/alerts/packs/effects-<id>`): every pack fills every slot of
/// `scripts/alert-packs/catalog.json` — severity beeps, app cues, geiger ticks. The `soundPack`
/// setting names one of them; My sounds overrides (`soundOverrideSlots`) win over its slots.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt
/// @parity /src/modules/settings/lib/appSounds.ts `EFFECTS_PACKS`
internal let effectsPackIds = ["retro", "simple", "hev", "clean"]

/// Pack standing in for an unknown id.
internal let effectsPackFallback = "simple"

internal func effectsPackId(_ pack: String) -> String {
  effectsPackIds.contains(pack) ? pack : effectsPackFallback
}

/// Group Ride events with their own app cue, each `cue.<event>` in every effects pack and a line
/// under the same key in every voice pack.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `GROUP_RIDE_CUES`
/// @parity /src/modules/settings/lib/appSounds.ts `APP_SOUND_CUES`
internal let groupRideCues = [
  "groupRide.created",
  "groupRide.joined",
  "groupRide.riderJoined",
  "groupRide.riderLeft",
  "groupRide.lost",
  "groupRide.restored",
]

/// App cue id (the `playAppSound` / `playAppCue` cue names) → effects slot.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `appCueSlot`
/// @parity /src/modules/settings/lib/appSounds.ts `APP_SOUND_CUES`
internal func appCueSlot(_ cue: String) -> String? {
  switch cue {
  case "on": return "cue.on"
  case "off": return "cue.off"
  case "error": return "cue.error"
  case "ride.end": return "cue.ride.end"
  default: return groupRideCues.contains(cue) ? "cue.\(cue)" : nil
  }
}

/// Voice key app cue `cue` speaks after its effect at Voice level `full`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `appCueVoiceKey`
internal func appCueVoiceKey(_ cue: String) -> String? {
  switch cue {
  case "on": return "link.connected"
  case "off": return "link.lost"
  case "error": return "system.error"
  case "ride.end": return "ride.end"
  default: return groupRideCues.contains(cue) ? cue : nil
  }
}

/// Clip files of every built-in pack's slots under `root` (the folder holding `effects-<id>/`),
/// keyed `"<pack>/<slot>"`. A pack whose manifest cannot be read contributes nothing.
internal func effectsPackSlotFiles(root: URL) -> [String: URL] {
  var files: [String: URL] = [:]
  for pack in effectsPackIds {
    let dir = root.appendingPathComponent("effects-\(pack)")
    // intentional-suppression: a missing or corrupt bundled manifest is reported by the player
    guard
      let data = try? Data(contentsOf: dir.appendingPathComponent("pack.json")),
      let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let slots = manifest["slots"] as? [String: String]
    else { continue }
    for (slot, file) in slots { files["\(pack)/\(slot)"] = dir.appendingPathComponent(file) }
  }
  return files
}

/// Voice pack each built-in effects pack's manifest names for the `matching` voice, keyed by pack id.
internal func effectsPackVoices(root: URL) -> [String: String] {
  var voices: [String: String] = [:]
  for pack in effectsPackIds {
    // intentional-suppression: a pack without a readable manifest matches the fallback voice
    guard
      let data = try? Data(contentsOf: root.appendingPathComponent("effects-\(pack)/pack.json")),
      let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let voice = manifest["voice"] as? String
    else { continue }
    voices[pack] = voice
  }
  return voices
}
