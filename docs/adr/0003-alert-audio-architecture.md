# SoundPool-based Alert Audio with Geiger Mode

Alert feedback replaces `ToneGenerator` with `SoundPool` playing bundled audio presets. Range alerts (threshold + thresholdMax) automatically use geiger mode — rapid ticking that accelerates with `rangeDepth`. Single-threshold alerts play a normal one-shot or triple-beep pattern. At `rangeDepth` 1.0, geiger loops the selected geiger preset continuously.

Each audio preset belongs to exactly one category: `single` or `geiger`. Single presets are for one-threshold alerts (voice clips, beeps, notification sounds). Geiger presets are short ticks designed for rapid repetition in range alerts. No preset spans both categories. The UI shows only the relevant list based on whether `thresholdMax` is set.

The `spec` column stores a URI-scheme identifier: `preset:beep`, `preset:tick`, etc. Future sources use their own scheme: `file:<uuid>` for user uploads, `tts:<key>` for generated speech. Native resolver splits on prefix to locate the audio. Existing bare values (`"default"`, `"urgent"`, `"pulse"`) are treated as `preset:` implicitly for backwards compatibility. The `rangeDepth != null` check (derived from `thresholdMax` presence) determines geiger vs single playback.

Audio assets live in `shared/alerts/`. A copy script (`bun run copy:shared`) places them into `android/src/main/res/raw/` (and later the iOS bundle). Format: OGG Vorbis, short clips (50–200ms for ticks, longer for voice clips).

The feedback layer (`AlertFeedback`) owns the geiger tick loop via `Handler.postDelayed()` scheduling. The alert engine stays a pure evaluator. Concurrent alerts from different rules mix via `SoundPool` — no priority system.

## Considered Options

- **Keep `ToneGenerator`.** Rejected because system tones sound poor and can't represent voice alerts or geiger ticks.
- **`MediaPlayer` for playback.** Rejected — too much latency for rapid geiger retriggering. `SoundPool` is designed for short, low-latency, overlapping samples.
- **`AudioTrack` raw PCM.** Rejected — maximum control but manual buffer management is unnecessary complexity for alert ticks.
- **Separate `playbackMode` column.** Rejected because `thresholdMax` presence already implies range/geiger behavior. Adding a column would duplicate intent and require migration.
- **User-uploaded custom sounds.** Deferred — file management, permissions, and format validation are too much surface for now. URI scheme (`file:<uuid>`) is ready for it.
- **Flat preset keys in DB.** Rejected — not extensible to user uploads or TTS without schema changes. URI scheme (`preset:`, `file:`, `tts:`) handles all sources in one column.
- **Two columns (spec + soundFileId).** Rejected — redundant, one always null. URI scheme is cleaner.
- **Priority system for concurrent alerts.** Rejected in favor of mixing. `SoundPool` handles concurrent playback natively. Simpler and avoids suppressing important alerts.
