import Foundation

/// Built-in effects packs (`shared/alerts/packs/effects-<id>`): every pack fills the required slots
/// of `scripts/alert-packs/catalog.json` (positive/info/warning/critical sounds, geiger ticks) and
/// may fill the optional cue slots (`optionalSlotFallback`). The `soundPack`
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

/// Optional effects slot → the required slot a pack that leaves it out plays instead.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `OPTIONAL_SLOT_FALLBACK`
internal let optionalSlotFallback = [
  "cue.on": "severity.positive",
  "cue.off": "severity.warning",
  "cue.ride.end": "severity.info",
  "cue.groupRide.created": "severity.positive",
  "cue.groupRide.joined": "severity.positive",
]

/// Group Ride events with an app cue and a line under the same key in every voice pack.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `GROUP_RIDE_CUES`
/// @parity /modules/vescape-core/src/index.ts `AppSoundCueId`
internal let groupRideCues = [
  "groupRide.created",
  "groupRide.joined",
  "groupRide.riderJoined",
  "groupRide.riderLeft",
  "groupRide.lost",
  "groupRide.restored",
]

/// App cue id (the `playAppCue` cue names) → effects slot. Error and the rider and link Group Ride
/// events have no slot of their own and play a fixed severity sound.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `appCueSlot`
/// @parity /modules/vescape-core/src/index.ts `AppSoundCueId`
internal func appCueSlot(_ cue: String) -> String? {
  switch cue {
  case "on": return "cue.on"
  case "off": return "cue.off"
  case "error": return "severity.critical"
  case "ride.end": return "cue.ride.end"
  case "groupRide.created", "groupRide.joined": return "cue.\(cue)"
  case "groupRide.riderJoined": return "severity.info"
  case "groupRide.riderLeft", "groupRide.lost": return "severity.warning"
  case "groupRide.restored": return "severity.positive"
  default: return nil
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
/// keyed `"<pack>/<slot>"`; an optional slot the pack leaves out maps to its `optionalSlotFallback`
/// clip. A pack whose manifest cannot be read contributes nothing.
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
    for (slot, fallback) in optionalSlotFallback where slots[slot] == nil {
      if let file = slots[fallback] { files["\(pack)/\(slot)"] = dir.appendingPathComponent(file) }
    }
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
