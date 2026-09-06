# 34. iOS background lifetime: location anchor + CB restoration, no Always auth

Date: 2026-08-17

## Status

Accepted

## Context

iOS has no equivalent of Android's foreground service. A ride-recording app must instead
combine the two lifetime tools Apple provides:

- **Anchor** (avoid suspension/jetsam while alive): an actively-delivering
  `CLLocationManager` with `allowsBackgroundLocationUpdates`. The `bluetooth-central`
  background mode only grants wake-ups for BLE events — it does not protect the process
  from jetsam.
- **Trapdoor** (relaunch after the process dies): significant-location-change / region
  monitoring (require Always authorization), or CoreBluetooth state restoration
  (`CBCentralManagerOptionRestoreIdentifierKey` + `willRestoreState`), which relaunches
  the app when a subscribed peripheral notifies and works with When In Use.

Field evidence (0.87.0): a 4-hour ride produced 2 GPS fixes and died mid-ride to jetsam —
nothing owned the process lifetime, and the Live Activity kept showing a live session for
hours after the process was dead. Strava-class apps solve this with Always authorization;
that buys them GPS-based relaunch but costs a scary permission prompt and battery.

For this app, BLE is the primary signal: no board connection means no telemetry worth
recording. GPS is secondary.

## Decision

- **When In Use authorization only.** The anchor is the active location manager, armed
  while the app is foregrounded (live map position) or while Ride Recording is active
  (background protection). Backgrounded and not recording → GPS off, process killable.
- **CoreBluetooth state restoration is the only trapdoor.** The Board Session central
  carries a restore identifier; the transport-detection central stays bare (probing never
  needs resurrection). After a kill mid-ride, the board's next notification relaunches the
  app headlessly.
- **Resurrection is fully native.** The restored session rebuilds from the saved Board
  Link: telemetry polling, Ride Recording (appending to the open recording — existing
  gap-splitting handles the dead interval), GPS, alerts, and the Live Activity all resume
  with no JS. JS remains a display/intent layer that attaches whenever the app is opened.
- **The Live Activity is render-only and must self-label death.** Every update carries a
  short `staleDate`; the widget renders an explicit stale/ended state via
  `context.isStale`. Orphan activities are reaped at app launch, and `StopRideIntent`
  ends the activity even when no session accepts the stop.
- **Recording never fabricates GPS.** A fix older than the age gate is not stamped onto
  telemetry frames; frames record no location and route gaps stay honest.

## Consequences

- During a ride the process is as protected as Strava's; the difference is only the
  resurrection path. Board off or out of range while the app is dead → no relaunch until
  the user opens the app, losing at most a GPS-only trace continuation. A user swipe-kill
  suppresses trapdoors by design (iOS treats it as intent) — accepted.
- No Always permission prompt, no significant-location battery cost, no App Store
  justification for continuous background location.
- Idle-pause (ADR 0021) naturally disarms the anchor after a stationary ride: recording
  halts → GPS off → process becomes killable. Reconnection later is covered by state
  restoration, not a live process.
- The `@platform-diff` story versus Android's foreground service is explicit: Android
  keeps the process alive with a service; iOS keeps it alive only while GPS-anchored and
  relies on relaunch otherwise.
