# Alert audio never goes silent or stalls

- **Never silent:** an unknown or pre-grammar sound spec plays the warning sound; a missing My sound falls back to the pack's slot clip; a pack missing an optional slot plays its required fallback slot.
- **Never stalls:** every playback item reports `FAILED` after a fixed timeout (`PlaybackCompletion`), so a lost completion (a SoundPool cue, a TTS engine that never calls back) never holds the Announcement Queue or a caller.
- **Speech overlaps the effect's tail:** a voice line starts when the sound before it ends, clamped between `ALERT_SPEECH_DELAY_MS` and `ALERT_SPEECH_MAX_DELAY_MS` after it starts, so a long effect's reverb plays under the voice instead of holding it back.
- **One single-threshold announcement per metric per evaluation:** the most severe wins; the rungs a fast climb skipped stay latched (spent, not pending). Range rules are continuous loops and pass through.
- **iOS `AVAudioSession` is process-global:** test and production players may overlap, so only the last owner deactivates it; stopping an alert test never silences the live Board alert player.
