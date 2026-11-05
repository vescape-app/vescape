# Free spin is detected from Board telemetry, not GPS

Free spin (the wheel spinning in the air or slipping) used to be found by comparing Board speed
with the phone's GPS speed. That needed a precise fix within 10 seconds, so it did nothing without
location permission, in tunnels or indoors. A fix up to 10 seconds old also let real spins through:
in the test backups, phantom peaks of 49 and 53 km/h survived as Max Speed. The comparison was tuned
by two rider settings that nobody could reason about.

We decided to detect free spin from the Board's own telemetry. Speeding up a wheel that carries a
rider takes a lot of motor current; a wheel in the air spins up on almost none.

## Status

Accepted. Supersedes the free-spin part of ADR 0038.

## Decision

- **Spin-up**: between two samples 5 ms–1.5 s apart, speed climbs at least 10 km/h/s while motor
  current stays under 35% of what a loaded Board needs for that climb (6.5 A per km/h/s). Motor
  current, not power or battery current: those are near zero at low speed whether or not the
  Board is loaded.
- **Latch**: a wheel already spinning at steady speed looks like cruising, so the samples after a
  spin-up stay excluded until 3 samples in a row change speed on a rider's worth of current, the
  speed returns within 5 km/h of where the spin started, or 15 s pass. The timeout does not apply
  while current stays under 5 A, which is a wheel held at the firmware speed limit in the air.
- **Fixed values, no per-Board state.** Learning values per Board changed no Max Speed on about
  100 hours from three riders and eight Boards (61–88 V). Values learned from early rides were
  wrong, because riders ride gently at first (#629).
- **Free spin is not riding.** It is excluded from Avg Speed and the Moving Window as well as Max
  Speed and Max Duty.
- **State carries across batches.** Each recording flush and each rebuilt hour continues from the
  previous one's state, so a spin crossing the edge stays excluded.

## Consequences

- Free spin works with no GPS at all, and the free-spin settings are gone.
- Changing the rule re-sanitizes history once, through the Ride summaries Maintenance Job.
- Not yet checked on 147–168 V Boards, light trick riders, or a spin held at the speed limit for
  longer than 15 s. The thresholds are physical, not per-Board, so a miss is a rule change and a
  history rebuild.
