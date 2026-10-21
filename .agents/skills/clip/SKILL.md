---
name: clip
description: Record a short Android emulator demo for Discord and propose a casual caption. Use when asked for a Discord clip or a short screen recording with accompanying message text.
---

# Clip

Produce a short, upload-ready MP4 and one ready-to-copy Discord message.

## Choose the flow

- Use the user's instructions first, then infer the feature, starting screen, interactions, and caption from the conversation. Ask only when the intended demo remains ambiguous.
- Default to a 5–15 second clip showing one feature. Hold the starting screen for at least 1 second; leave at least 1 second between interactions and after the last interaction. Allow transitions to finish and the result to be readable. Honor longer requested holds.
- If the flow needs more time, shorten its scope or split into clips rather than speeding through interactions. Keep playback at normal speed.
- Draft text from supplied wording and relevant context. Match the user's language and casual voice, with light humor when it fits. Prefer 1–3 short sentences, no greeting or sign-off, and at most a couple of emojis. Mention only supported capabilities; distinguish what the video shows from contextual extras.

## Record

1. Always record an Android emulator, never a physical phone. Use the project's emulator/navigation guidance when available. Run `adb devices -l` and explicitly select the emulator serial for every command. If none is running, start one using the project workflow; if multiple emulators remain plausible, ask which one.
2. Stage the starting screen before recording. Inspect a screenshot and its actual pixel dimensions before choosing tap coordinates; image previews may be scaled. Use accessible elements where practical. For local UI changes, follow the repository's build/Metro verification rules before using the recording as evidence.
3. Record with Android `screenrecord` to a unique device path. Automate the timed interactions in one process so tool round trips do not add idle footage. Stop gracefully with SIGINT to finalize the MP4, then pull it to a descriptive, timestamped file on the Desktop or the user's requested directory. Retain the original until the export is verified.
4. Inspect the recording at the start, each transition, and the end. Confirm the intended taps worked, the result appears, and the pacing meets the requested holds. Re-record a failed sequence instead of delivering it.

## Fit Discord

- Fit every delivered clip within **20,000,000 bytes**, the chosen budget for Discord Free. Keep the original resolution and quality when it already fits; compress larger clips automatically, targeting at most 19,000,000 bytes to leave headroom.
- Measure actual file size and duration with filesystem metadata and `ffprobe`. Deliver the original MP4 when compatible. For playback compatibility, prefer H.264 with `yuv420p` and `-movflags +faststart`; omit audio unless requested. Remux without re-encoding when only container changes are needed.
- Compress when the clip exceeds the budget or the user requests a smaller file. Preserve the original and write a separate export. Start with H.264 CRF 23 and at most 30 fps; increase CRF or reduce resolution while keeping the demonstrated UI legible. Preserve aspect ratio, even dimensions, normal playback speed, and minimum holds.
- Verify the actual export size after encoding and adjust until it fits. Two-pass encoding can use a video bitrate budget of `floor(19_000_000 * 8 * 0.9 / duration_seconds)` for silent clips.
- Check playback and representative frames again after any conversion. Confirm the export shows the intended flow and fits the 20,000,000-byte budget; report any blocker plainly.

## Deliver

Return a clickable local video link, duration and file size, followed by the proposed Discord message. Keep the response short. Reveal the file in the file manager only when asked. Posting to Discord requires an explicit request to send it.

Example invocation: `/clip 1s on telemetry, tap weather, 4s in weather. Caption: idk if you know, weather is also on the watch.`
