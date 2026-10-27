# Announcement Queue serializes non-critical audio

Connection cues, the ride-end cue and Group Ride cues used to play the moment they were triggered. SoundPool cues and voice clips overlapped, TTS flushed whatever was speaking, and a burst at connect (connect cue, Group Ride rejoin, later weather and battery lines) became noise. Telemetry alerts are the safety-relevant audio and must never wait behind any of it. We decided that every non-critical announcement goes through one native **Announcement Queue** per alert player. Telemetry alerts stay outside it and pre-empt it.

## Decision

- **Priority first, then age.** `CONNECTION` (connect, disconnect, connection error) › `ADVISORY` (ride end, later weather and battery) › `SOCIAL` (Group Ride). Each item has an expiry (10 s / 30 s / 20 s by priority). An item still waiting past it is dropped, because a stale "rider joined" is worse than none.
- **One at a time, on completion.** The queue waits on the item's `PlaybackOutcome` (#602), not on a timer guess. The 30 s playback timeout bounds a lost completion.
- **Settle window after connect.** For 4 s after a connect only connection items play, so the connect cue is heard first and the rest follow once it finishes.
- **Critical audio pre-empts.** A single-threshold alert's severity sound or spoken line plays immediately. The queued item playing at that moment is stopped and put back once, unless it expired meanwhile. The queue resumes 2 s after the last critical item ends, so a queued line does not run straight into the alert.
- **Geiger does not count as critical.** Ticks and sustained tones run continuously; holding the queue on them would starve it.
- **Native owns it.** `groupRide.created` moved from JS to `GroupRideObserver`, so every cue plays while JS is suspended and the JS `playAppCue` bridge is gone.
- **A pure, clock-injected core** (`AnnouncementQueue`) decides order and timing. The alert player hosts it on its audio thread and does the playing, so the policy is unit-tested without audio.

## Considered Options

- **Let the platform queue it (TTS `QUEUE_ADD`, AVSpeechSynthesizer's queue).** Rejected: it covers only TTS, not SoundPool cues or voice-pack clips, and has no priority, expiry or pre-emption.
- **Telemetry alerts in the same queue at top priority.** Rejected: an alert would still wait for the playing item to finish. Alerts must be immediate.
- **Hold the queue on Geiger too.** Rejected: nothing queued would ever play during a long Geiger band.

## Consequences

- A cue can be heard up to its expiry late, or not at all. That is accepted for non-critical audio.
- A pre-empted effect-only cue may tail out under the alert (SoundPool cues are short and not stopped); pre-empted speech is cut.
- New producers (weather, battery at connect) enqueue through the player's `announce` seam with a priority, and need no new ordering code.
