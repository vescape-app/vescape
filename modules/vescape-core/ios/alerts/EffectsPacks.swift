import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt
/// @parity /src/modules/settings/lib/appSounds.ts `EFFECTS_PACKS`
internal let effectsPackIds = ["arc", "pulse", "hev"]

internal let effectsPackFallback = "arc"

internal let renamedEffectsPackIds = ["clean": "pulse"]

internal func effectsPackId(_ pack: String) -> String {
  effectsPackIds.contains(pack) ? pack : effectsPackFallback
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `OPTIONAL_SLOT_FALLBACK`
internal let optionalSlotFallback = [
  "cue.on": "severity.positive",
  "cue.off": "severity.warning",
  "cue.ride.end": "severity.info",
  "cue.groupRide.created": "severity.positive",
  "cue.groupRide.joined": "severity.positive",
]

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `lookupSlot`
internal func lookupSlot(_ slot: String, hasOverride: (String) -> Bool, packHas: (String) -> Bool) -> String {
  if hasOverride(slot) || packHas(slot) { return slot }
  return optionalSlotFallback[slot].map { lookupSlot($0, hasOverride: hasOverride, packHas: packHas) } ?? slot
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `GROUP_RIDE_CUES`
internal let groupRideCues = [
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
]

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `appCueSlot`
internal func appCueSlot(_ cue: String) -> String? {
  switch cue {
  case "on": return "cue.on"
  case "off": return "cue.off"
  case "error": return "severity.critical"
  case "ride.end": return "cue.ride.end"
  case "groupRide.created", "groupRide.joined": return "cue.\(cue)"
  case "groupRide.riderJoined", "groupRide.signal.sent", "groupRide.hazard.sent", "groupRide.signal.down",
    "groupRide.signal.wait", "groupRide.signal.break":
    return "severity.info"
  case "groupRide.riderLeft", "groupRide.lost": return "severity.warning"
  case "groupRide.restored", "groupRide.signal.ok", "groupRide.signal.cleared": return "severity.positive"
  case "groupRide.signal.serious": return "severity.critical"
  case "groupRide.signal.minor", "groupRide.signal.battery", "groupRide.signal.tire", "groupRide.signal.overheat", "groupRide.signal.board":
    return "severity.warning"
  case "groupRide.hazard.water", "groupRide.hazard.terrain", "groupRide.hazard.obstacle", "groupRide.hazard.police":
    return "severity.warning"
  default: return nil
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `appCueVoiceKey`
internal func appCueVoiceKey(_ cue: String) -> String? {
  switch cue {
  case "on": return "boardConnection.connected"
  case "off": return "boardConnection.lost"
  case "error": return "system.error"
  case "ride.end": return "ride.end"
  default: return groupRideCues.contains(cue) ? cue : nil
  }
}

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
