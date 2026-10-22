# Effects packs

Effects packs (Arc, Pulse, HEV) are made by hand in a DAW and committed as finished
files under `shared/alerts/packs/effects-<id>/`. Nothing generates them; `bun run alerts:packs`
builds voice packs only. Runtime behavior (slot fallbacks, previews) is in
[docs/alerts.md](../../docs/alerts.md#sound-effects).

## Slots

Required in every pack:

| Slot                | Sound                                             |
| ------------------- | ------------------------------------------------- |
| `severity.positive` | short rising two- or three-note chime (cues only) |
| `severity.info`     | info alert (HEV/Pulse: 1 beep)                    |
| `severity.warning`  | warning alert (HEV/Pulse: 2 beeps)                |
| `severity.critical` | critical alert (HEV/Pulse: 3 beeps)               |
| `geiger.soft`       | lightest geiger tick                              |
| `geiger.mid`        | middle geiger tick                                |
| `geiger.hard`       | hardest geiger tick                               |

Optional; a missing slot plays its fallback (native `OPTIONAL_SLOT_FALLBACK` /
`optionalSlotFallback` in `EffectsPacks.kt` / `EffectsPacks.swift`):

| Slot                    | Fallback            |
| ----------------------- | ------------------- |
| `cue.on`                | `severity.positive` |
| `cue.off`               | `severity.warning`  |
| `cue.ride.end`          | `severity.info`     |
| `cue.groupRide.created` | `severity.positive` |
| `cue.groupRide.joined`  | `severity.positive` |

All three built-in packs fill every optional slot. Effects packs never contain voice.

## File format

- AAC-LC in `.m4a`, mono, 22 050 Hz, 40 kbit/s, no metadata. Native drops the ~1024-sample AAC
  encoder priming.
- No loudness normalization is applied anywhere. Match the existing packs by ear: synthesized
  tones sit around −6 dBFS peak (sox `vol 0.5`), recorded clips peak just below 0 dBFS. Keep peaks
  under 0 dBFS.
- No length limit is enforced. Severity sounds stay short (≤ ~1.1 s) except Arc's, whose recorded
  tails run up to ~5 s under the voice (speech starts at most 1.5 s in); ticks ~10–25 ms;
  the longest cue today is 4.3 s (Arc `cue.groupRide.created`). Every slot is decoded into
  memory at player start, so keep files short.

Export a WAV from the DAW, then encode it (bitexact flags keep re-encodes byte-identical):

```sh
ffmpeg -v error -y -i slot.wav -ac 1 -ar 22050 -c:a aac -b:a 40k -map_metadata -1 \
  -fflags +bitexact -flags:a +bitexact severity.info.m4a
```

## pack.json

```json
{
  "id": "hev",
  "kind": "effects",
  "voice": "radio",
  "format": "aac-lc m4a, mono 22050 Hz",
  "slots": {
    "severity.positive": "severity.positive.m4a",
    "geiger.hard": "geiger.hard.m4a"
  }
}
```

`slots` maps every filled slot to its file, relative to the pack folder. `voice` names the voice
pack the `matching` Voice setting plays (`nova` or `radio`).

## Adding a pack

1. Create `shared/alerts/packs/effects-<id>/` with the `.m4a` files and `pack.json`.
2. Register the id in `EFFECTS_PACK_IDS` (`modules/vescape-core/android/.../alerts/EffectsPacks.kt`),
   `effectsPackIds` (`modules/vescape-core/ios/alerts/EffectsPacks.swift`), and `EFFECTS_PACKS`
   (`src/modules/settings/lib/appSounds.ts`, display name and matching voice).
3. Run `bun run copy:shared` (or `bun run android` / `bun run ios`) to copy packs into the native
   asset folders.

## Arc recordings

Arc's severity sounds and cues are recordings, mastered in mono to raise their average level
before the AAC encode above:

```sh
sox -D -R input.wav -r 22050 -b 16 -c 1 slot.wav channels 1 rate 22050 \
  compand 0,0.1 '6:-80,-80,-40,-25,-20,-12,0,-10' norm -1.5
```

## Sox recipes (HEV, Pulse)

HEV and Pulse were synthesized with sox; these commands reproduce each slot. Arc is
recorded, and so are Pulse's two Group Ride cues (no recipe below). Build the WAV, then encode it as above.

```sh
R="-D -R -r 22050 -b 16 -c 1"
# tone OUT DUR SYNTH VOL FADE_IN FADE_OUT [EXTRA_FX...]
tone() { o=$1 d=$2 s=$3 v=$4 i=$5 f=$6; shift 6
  sox $R -n "$o" synth "$d" $s "$@" fade t "$i" "$d" "$f" vol "$v"; }
gap() { sox $R -n "$1" trim 0 "$2"; }   # gap OUT SECONDS
# join: sox -D -R a.wav b.wav ... slot.wav
```

Defaults where a slot gives none: vol 0.5, fade in 0.005, fade out 0.02.

### HEV

Beep: `tone b.wav 0.24 "sine 967" 0.5 0.01 0.02`, beeps separated by `gap g.wav 0.18`.

```sh
# severity.positive
tone 1.wav 0.08 "sine 967" 0.5 0.005 0.02; gap 2.wav 0.03
tone 3.wav 0.16 "sine 1292" 0.5 0.01 0.06; sox -D -R 1.wav 2.wav 3.wav slot.wav
# severity.info / warning / critical: 1 / 2 / 3 beeps
sox -D -R b.wav slot.wav
sox -D -R b.wav g.wav b.wav slot.wav
sox -D -R b.wav g.wav b.wav g.wav b.wav slot.wav
# cue.on
tone 1.wav 0.1 "sine 660" 0.5 0.005 0.02; gap 2.wav 0.04
tone 3.wav 0.18 "sine 967" 0.5 0.005 0.02; sox -D -R 1.wav 2.wav 3.wav slot.wav
# cue.off
tone 1.wav 0.1 "sine 967" 0.5 0.005 0.02; gap 2.wav 0.04
tone 3.wav 0.18 "sine 660" 0.5 0.005 0.02; sox -D -R 1.wav 2.wav 3.wav slot.wav
# cue.groupRide.created
tone 1.wav 0.08 "sine 660" 0.5 0.005 0.02; gap 2.wav 0.03
tone 3.wav 0.08 "sine 830" 0.5 0.005 0.02
tone 5.wav 0.16 "sine 967" 0.5 0.005 0.02; sox -D -R 1.wav 2.wav 3.wav 2.wav 5.wav slot.wav
# cue.groupRide.joined
tone 1.wav 0.07 "sine 967" 0.5 0.005 0.02; gap 2.wav 0.04; sox -D -R 1.wav 2.wav 1.wav slot.wav
# cue.ride.end
tone 1.wav 0.1 "sine 967" 0.5 0.005 0.02; gap 2.wav 0.03
tone 3.wav 0.1 "sine 830" 0.5 0.005 0.02
tone 5.wav 0.24 "sine 660" 0.5 0.005 0.02; sox -D -R 1.wav 2.wav 3.wav 2.wav 5.wav slot.wav
# geiger.soft / mid / hard
tone slot.wav 0.012 "sine 1800" 0.35 0.001 0.008
tone slot.wav 0.008 whitenoise 0.6 0 0.006 highpass 1500
tone slot.wav 0.014 whitenoise 0.9 0 0.01 highpass 600 overdrive 6
```

### Pulse

Beep: `tone b.wav 0.2 "sine 880" 0.5 0.01 0.05`, beeps separated by `gap g.wav 0.16`;
severity.info / warning / critical are 1 / 2 / 3 beeps as in HEV.

```sh
# severity.positive
tone 1.wav 0.12 "sine 659" 0.5 0.01 0.06; gap 2.wav 0.02
tone 3.wav 0.24 "sine 988" 0.5 0.01 0.18; sox -D -R 1.wav 2.wav 3.wav slot.wav
# cue.on
tone 1.wav 0.14 "sine 587" 0.5 0.01 0.08; gap 2.wav 0.02
tone 3.wav 0.26 "sine 880" 0.5 0.01 0.2; sox -D -R 1.wav 2.wav 3.wav slot.wav
# cue.off
tone 1.wav 0.14 "sine 880" 0.5 0.01 0.08; gap 2.wav 0.02
tone 3.wav 0.26 "sine 587" 0.5 0.01 0.2; sox -D -R 1.wav 2.wav 3.wav slot.wav
# cue.ride.end
tone 1.wav 0.12 "sine 784" 0.5 0.01 0.06; tone 2.wav 0.12 "sine 659" 0.5 0.01 0.06
tone 3.wav 0.36 "sine 523" 0.5 0.01 0.3; sox -D -R 1.wav 2.wav 3.wav slot.wav
# geiger.soft / mid / hard
tone slot.wav 0.015 "sine 1400" 0.3 0.002 0.01
tone slot.wav 0.02 "sine 1000" 0.5 0.001 0.014
tone slot.wav 0.022 "square 700" 0.45 0 0.016
```
