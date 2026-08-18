# Vescape App Context

This context defines the shared language for the Vescape app. The app centers on live board state, ride recording, ride history, and safety-sensitive Refloat tuning.

## Language

**Board**:
A saved rideable device that can be connected over BLE and may expose one motor controller through CAN.
_Avoid_: Device, controller, scooter

**Board Link**:
The saved, probe-confirmed reachability details for a Board, including BLE peripheral id, selected Board Transport, and capabilities or firmware facts discovered for that transport.
_Avoid_: Pairing, connection settings, device config

**Board Link Version**:
The app-defined version of which facts a Board Link was created to capture.
_Avoid_: Link schema, probe schema, capability version

**Stale Board Link**:
A saved Board Link whose probe-confirmed facts no longer match the connected controller or stop being observed.
_Avoid_: Broken link, invalid board, firmware error

**Link Integrity Check**:
A background live-session re-probe that compares saved Board Link facts with the connected controller before firmware-dependent commands are trusted.
_Avoid_: Health check, version check, preflight

**Board Session**:
The lifecycle of a single live BLE-bound connection to a Board, from connect attempt through disconnect. Owns the in-flight identity used to discard stale callbacks across reconnects. Distinct from Ride Recording, which is the persisted ride capture.
_Avoid_: Session, connection, BLE session

**Board Transport**:
The resolved path used to reach a Board's telemetry: Direct (the BLE-connected controller is the data source) or CAN-forwarded to a specific CAN id. A durable per-Board fact, not per-session. Absence means the transport has not been detected yet.
_Avoid_: Connection path, routing, channel

**Board Firmware Identity**:
The probe-confirmed firmware identity of a Board controller, including Refloat package version when available.
_Avoid_: Refloat version, firmware string, fw version, tune version

**Board Probe**:
A pre-save check that a scanned BLE peripheral can produce telemetry over at least one Board Transport and produce a Board Link. The rider-facing UI calls running a Board Probe "linking" (and re-running it "re-linking") — the screen, buttons, and progress timeline say "link", while the domain and code keep "Board Probe" for the act and "Board Link" for the saved result.
_Avoid_: Validation, test connection, scan

**Live State**:
The current app-visible snapshot of board connection, GPS, scan, recording, and recent telemetry state.
_Avoid_: UI state, cached status

**Telemetry Sample**:
A single decoded board data point captured from the connected board.
_Avoid_: Packet, frame, event

**Telemetry Stale**:
A live Board Session condition where expected telemetry samples stop arriving.
_Avoid_: Stale Board Link, disconnected

**Metric Sanitizer**:
A rule that marks an implausible telemetry-derived value as excluded from ride metrics without changing the original sample.
_Avoid_: Filter, smoother, cleaner

**Metric Exclusion**:
A durable annotation that explains why a metric value from a Telemetry Sample was left out of one or more ride metrics.
_Avoid_: Deleted value, hidden sample, rejected packet

**Battery SoC Estimate**:
The processed battery charge percentage — IR-compensated then median-windowed over a configurable interval — that the app displays and evaluates battery **Alert Rules** against, while raw pack voltage stays the **Telemetry Sample**.
_Avoid_: Battery level, voltage percent, smoothed battery (in raw-telemetry contexts)

**Live BMS Series**:
The native-retained, in-memory series of smart-BMS per-cell-group voltages and balancing state, held within the recent live-telemetry window (`liveHistoryLimit`, default 5 min) and never persisted. Native retains it continuously during a **Board Session** — the BMS is already polled, so retention is free — but it crosses the bridge to JS only on demand, while the battery-detail view is focused, so that view can scrub cells at any past moment in the window. The always-on cell **spread** (delta) is not part of the 30Hz telemetry frame nor persisted with telemetry history; it is derived from the latest smart-BMS frame on the BMS event pipe (`onBms`, ~4Hz), which flows continuously and independently of the battery-detail view. Used to watch battery sag and spot a cell group breaking away from the pack in real time, not to track battery health over the pack's life. Dies with the **Board Session** or as it rolls off the window.
_Avoid_: Battery Diagnostic Snapshot, BMS telemetry sample, cell voltage log, battery ride sample, BMS history

**GPS Fix**:
A single phone location sample used for live map position or ride recording.
_Avoid_: Location event, GPS point

**Ride Recording**:
A persisted ride capture made from board telemetry samples, optionally enriched with precise GPS fixes captured at the same time as telemetry.
_Avoid_: Session recording, raw recording

**Privacy Zone**:
A user-defined geographic area where Ride Recording data is not retained.
_Avoid_: Save area, safe area, hidden zone

**Ride History**:
The persisted list of past ride recordings and their derived samples, routes, markers, and summaries.
_Avoid_: Playback, logs

**Ride History Marker**:
A map-visible point in Ride History that explains a ride boundary, connection loss, interruption, or notable recording condition.
_Avoid_: Telemetry marker, debug marker, log point

**Moving Window**:
The span of a Ride Recording from its first to its last moving Telemetry Sample — the part the rider treats as actual riding. A Telemetry Sample counts as moving when it is not excluded from speed metrics (so low-speed and free-spin samples do not count). Leading and trailing non-moving spans fall outside the Moving Window; internal stops (photos, cooldown) stay inside it. Drives history-timeline trimming and the moving ride time shown in stats. A Ride Recording with no moving samples has no Moving Window and is not shown in Ride History; legacy recordings with an unknown Moving Window fall back to their full wall-clock span.
_Avoid_: Trim range, active range, ride duration

**Idle Pause**:
A temporary state of a Ride Recording in which sample persistence halts because the Board has produced no moving Telemetry Sample for a sustained interval, while the Board Session stays live at a reduced poll rate and auto-resumes on the next moving sample. Cuts battery, stored frames, and bucket sample counts together while the board is parked.
_Avoid_: Stop recording, auto-stop, sleep, parked mode

**Favorite**:
A user-created, optionally named durable time range over Ride History, created by trimming a past ride to the span the rider wants to keep. A ride may produce multiple Favorites. Its name can be changed or cleared later, and re-trimming updates its range and recomputed summary while preserving its identity and Favorite Media. A Favorite pins its telemetry range: history deletion skips favorited ranges, and removing a Favorite only unpins — it never deletes telemetry. Owns its Favorite Media.
_Avoid_: Favorite ride, segment, bookmark, saved ride

**Favorite Media**:
A photo or video the rider explicitly attached to a Favorite, copied from the OS picker into app storage owned by that Favorite and recorded in the native Favorite Media manifest. Placed on the map using a nearby recording-backed GPS fix by capture time. Deleted together with its Favorite.
_Avoid_: Media History Asset, ride photo, gallery match, uploaded media

**Map Point**:
A globally shared, Account-authored map-visible location that is independent from Ride Recording and Ride History. A Map Point describes a categorized riding place such as a drop, bonk, trail entry, viewpoint, or charging place; a personal navigation target is not a Map Point. Reading a Map Point needs no account; contributing or changing one requires sign-in.
_Avoid_: Marker, GPS point, telemetry marker, direction point

**Direction Point**:
One rider's private navigation target on the map, stored on the phone only. It is not a Map Point: it is never shared as a place, has no category, author or reactions, and Group Ride presence reads it natively.
_Avoid_: Direction map point, navigation Map Point, destination marker

**Navigation**:
The rideable path from the rider to their **Direction Point**, following real ways rather than a straight line. Navigation exists exactly while a Direction Point is set and is native-owned so it survives backgrounding. Once computed it is fixed for the ride, so the rider is free to wander without it changing under them. It describes where the rider could go and is never **Ride History**, which records where they did go.
_Avoid_: Route, ride route, navigation mode, guidance, directions

**Route Progress**:
Where the rider is along their **Navigation** right now: the point on the path nearest to them, how far is left to the **Direction Point** from there, and the bearing to an aim point a short way further along. It is derived and never stored, it changes with every **GPS Fix**, and it ends with the Navigation it belongs to. Navigation is the fixed path; Route Progress is the moving place on it.
_Avoid_: Navigation progress, route position, ETA, remaining route, navigation fix

**Navigation Profile**:
The kind of ways a **Navigation** may follow, such as footpaths or cycleways. The rider chooses it while looking at a path and the last choice carries to the next Navigation. It is not a **Map Camera Profile**, which is camera behavior, nor a **Tune Profile**, which is board settings.
_Avoid_: Navigation mode, routing mode, travel mode, way preference

**Map Point Reaction**:
One Account's `up` or `down` vote on one Map Point. A reaction belongs to exactly one Account and one Map Point, changing it replaces the row, and removing it deletes the row. The score is derived by adding up votes and subtracting down votes; it is never stored on the Map Point.
_Avoid_: Like flag, liked point, reaction column on Map Point

**Map Camera Controller**:
The app-owned volatile coordinator for map camera position, zoom, pitch, heading, padding, animation, and transitions between live follow, manual browse, and ride history framing.
_Avoid_: Map manager, map state manager, camera helper

**Map Camera Intent**:
A user or app request for the Map Camera Controller to choose the next camera state, such as following live GPS, browsing manually, or framing ride history.
_Avoid_: Camera command, map action, imperative camera call

**History Camera Refinement**:
The Map Camera Controller's in-flight adjustment from approximate Ride History framing to exact route framing for the same selected ride.
_Avoid_: Second jump, route correction, recenter after load

**Map Camera Profile**:
A named camera behavior used by the Map Camera Controller to derive heading, zoom, pitch, padding, and animation policy for a view or Map Orientation Mode.
_Avoid_: Tilt setting, view camera hack, mode special case

**Map Orientation Mode**:
The rider's chosen map camera orientation: north up, GPS heading, compass, or free rotate. It says which way the map faces, not where the rider is going.
_Avoid_: Navigation mode, map navigation, heading mode

**Tune Snapshot**:
A read-only view of the board's current Refloat tuning configuration decoded from the board's schema and binary config.
_Avoid_: Tune cache, settings dump

**Tune Profile**:
A user-authored, persisted set of all Refloat tune field values stored in semantic (human-meaningful) units, scoped to a Board.
_Avoid_: Tune preset, config file, settings backup

**Tune Compatibility**:
The normalized base Refloat package version scope in which a Tune Profile is allowed to be used.
_Avoid_: Tune migration, tune schema version, firmware conversion

**Tune History Entry**:
An immutable snapshot of a Tune Profile's field values captured immediately before an explicit save, enabling rollback to any prior state.
_Avoid_: Sync log, change event, audit trail

**Tune Preview**:
A comparative read-only visualization of board-angle response derived from a Tune Profile, synthetic rider-load and terrain inputs, and an idealized board model without motor-power, traction, or nosedive limits.
_Avoid_: Board simulator, ride simulator, physics simulation

**Pitch Input**:
A Tune Preview input representing a bounded pitch rate applied to Board while the gesture is held. Its magnitude controls how quickly angle error is added; it never constrains Board angle. Target, controller current, and speed remain simulation outputs.
_Avoid_: Deck disturbance, rider lean, foot pressure, throttle, acceleration command

**Posi Sensor**:
A footpad sensor mode that treats both sensor zones as one engagement zone.
_Avoid_: Posi switch, dual switch

**Legal Policy**:
The jurisdiction rules currently applicable across Boards, including the Legal Speed Limit, Legal Warning Speed, and Legal Road Status.
_Avoid_: Legal Mode policy, legal settings

**Legal Mode**:
A durable per-Board choice to apply the current Legal Policy through mandatory speed warnings and board-enforced constraints.
_Avoid_: Legal Policy, Police mode, cop mode, inspection mode

**Legal Speed Limit**:
The jurisdiction-defined target maximum riding speed in the current Legal Policy.
_Avoid_: Max board speed, engine limit

**Board Top Speed**:
The rider-entered maximum speed the rider rides a specific **Board** at, held per-Board as a **Board Setting**. Drives that Board's speed gauge full-scale and the km/h thresholds a speed **Alert Preset** level resolves to (a level is a percentage of this value). Not a legal or firmware limit — a personal figure for this Board. Distinct from **Legal Speed Limit** (a legal target) and from any controller top-speed setting.
_Avoid_: Rider Top Speed (former profile-level name), Legal Speed Limit, max board speed, speed cap

**Legal Warning Speed**:
The jurisdiction-defined speed in the current Legal Policy at which Legal Mode starts audible warning feedback before the Legal Speed Limit is reached.
_Avoid_: Alert threshold, warning threshold

**Legal Road Status**:
The jurisdiction-specific rider-facing status of whether this Board category appears road-legal, restricted, unknown, or not road-legal.
_Avoid_: Legal yes/no, police status

**Board Move**:
A deliberate rider command that moves a disengaged Board from the app without starting a Ride Recording.
_Avoid_: Move board, Remote Tilt, throttle

**Firmware-Dependent Command**:
A rider intent that depends on the connected controller's Refloat behavior rather than telemetry alone.
_Avoid_: Runtime command, board action, unsafe command

**Alert Rule**:
A user-defined telemetry threshold, owned by one **Board**, that can trigger board-riding feedback during a live connection to that Board. Comes in three flavors: a **One-Shot Alert Rule**, a **Repeating Alert Rule**, and a **Geiger Alert Rule**.
_Avoid_: Alarm, notification

**One-Shot Alert Rule**:
An **Alert Rule** with a single threshold that announces once per crossing and stays silent until the metric re-arms it.
_Avoid_: Single alert, point alert

**Repeating Alert Rule**:
A single-threshold **Alert Rule** that keeps announcing on a rider-chosen fixed interval for as long as the metric stays past its threshold.
_Avoid_: Recurring alert, nag (informal only), geiger

**Geiger Alert Rule**:
An **Alert Rule** with both a threshold and a thresholdMax whose ticking accelerates with **Alert Range Depth** and holds a sustained tone past thresholdMax.
_Avoid_: Range alert, progressive alert

**Alert Range Depth**:
How far a metric has travelled through a **Geiger Alert Rule**'s band, as a 0–1 fraction that saturates at 1 past thresholdMax; the sole driver of tick cadence.
_Avoid_: Severity, intensity, progress

**Alert Re-Arm**:
The return of a fired single-threshold **Alert Rule** to a state where it can announce again, requiring the metric to fall back past its threshold by a per-metric margin so a value hovering on the line cannot re-announce.
_Avoid_: Reset, cooldown, debounce, hysteresis (the mechanism, not the concept)

**Alert Sound**:
A bundled audio asset used for alert feedback, belonging to exactly one category: single (one-threshold alerts) or geiger (range alerts with progressive ticking). Selected on an **Alert Rule** via its sound type.
_Avoid_: Alert Preset (now the rider's intensity concept), sound effect, ringtone, tone

**Alert Preset**:
A rider-selected intensity level for one telemetry metric (battery, speed, duty, motor temperature, controller temperature) that expands into a set of **Alert Rules** at once. Motor and controller temperature are independent presets. Held per-**Board** as a **Board Setting** — each Board carries its own levels. The level is durable truth; the rules it produces are virtual — derived from the level, tagged by source, and regenerated as a whole when the level changes, never hand-edited one by one. Manual **Alert Rules** may coexist alongside a preset's rules for the same metric. A metric with the preset disabled has no preset-sourced rules.
_Avoid_: Alert Sound (the audio asset), Alert Level as a rules concept, warning pack

**Alert Message Template**:
A user-authored spoken phrase on a single-threshold **Alert Rule** that may include current alert-value placeholders and is spoken by native text-to-speech when the rule fires.
_Avoid_: TTS sound, voice preset, notification text

**Watch Mirror**:
The platform-neutral concept of the app on the rider's wrist that mirrors live board state and plays alert feedback. Display and playback only — it owns no durable truth, makes no alert decisions, and sends nothing back to the phone. A one-way reflection of phone truth. Has two concrete implementations: the **Wear OS Mirror** (Kotlin/Compose, Android) and the future **watchOS Mirror** (Apple Watch).
_Avoid_: Wear Mirror (bakes in Google's Wear OS brand; use for the Android impl only), watch app, companion (Companion names the CompanionDeviceManager board-presence association, not the watch)

**Watch Frame**:
The compact, throttled telemetry snapshot the phone pushes to a **Watch Mirror** to drive its display. Distinct from a **Telemetry Sample** (raw, per-packet) and from **Live State** (the full app snapshot sent to JS).
_Avoid_: Watch payload, wear message

**Watch Alert**:
A one-shot command the phone pushes to a **Watch Mirror** when the native alert engine fires, telling it to vibrate and/or sound. Carries no threshold logic — the alert decision already happened on the phone against an **Alert Rule**.
_Avoid_: Wear alarm, watch notification

**Board Warning**:
An app-detected abnormal Board condition worth the rider's attention — such as excessive cell-voltage spread, unstable telemetry readings, or a dangerous VESC/Refloat setting. Detected natively, keyed one-per-problem-kind per Board (re-detection updates the same warning rather than duplicating it), and carries a severity of warn or critical. Stored durably like automotive fault codes: it clears automatically when its detector re-evaluates with real data and the condition is gone, and the rider may clear it manually — but a still-true condition simply re-fires it. Detection logic is app-authored (unlike a rider-authored **Alert Rule**) and the finding is rider-facing (unlike a debug-facing **Diagnostic Event**).
_Avoid_: Board alert (collides with Alert Rule), fault (reserved for VESC firmware fault codes), board issue, health event

**Debug Recording**:
A developer-facing `.jsonl` capture of one Board Session — raw BLE traffic, session-state transitions, GPS fixes, and phone sensor readings the board never sees (compass heading) — plus a `meta` header describing the board it was recorded from. Recorded on-device and exportable for offline analysis or detector replay. Replaying one drives a real session through the transport seam, and the recording owns that session's position, heading and time for its whole duration. Not a **Ride Recording** (no telemetry-sample persistence, not rider-facing) and not part of **Ride History**.
_Avoid_: session log, BLE dump, trace

**Session Clock**:
The source of "now" for one **Board Session**. Every timestamp the session stamps onto data it produces, and every comparison against those timestamps, reads it instead of the system clock. A real session's Session Clock is wall time; a replay's can run ahead of real time (see **Replay Speed**). The rule is all-or-nothing — mixing wall time and session time inside one session produces data that disagrees with the code reading it — with one carve-out: throttles that guard a resource rather than describe the ride stay on wall time.
_Avoid_: virtual clock, fake time, clock offset

**Replay Speed**:
How fast a replay's **Session Clock** runs against real time. `1×` — the default, and what the Replay UI uses — reproduces a ride exactly as it happened. A caller may instead ask for a warmup: an opening stretch of the recording delivered faster, so the session comes up with its live charts already filled instead of spending real minutes earning them. Playback drops to 1× once the warmup window has elapsed.
_Avoid_: fast-forward, playback rate, time scale

**App Setting**:
A user-controlled app preference that affects app behavior across boards unless explicitly scoped elsewhere.
_Avoid_: Option, config

**Settings Drawer**:
The edge drawer behind the top-right button on the main screen: the **Vescape Account**, the app's live self-status (backup, version, storage), the few settings worth one tap, and one link to Advanced settings for everything else. Its button wears whatever inside it needs attention — a required update, or a running backup with its progress — the way the Social button wears an active **Group Ride**.
_Avoid_: settings menu, settings popover, quick settings

**Board Setting**:
A rider-adjustable preference or soft state scoped to one **Board**, stored schemalessly per Board (key-value). Distinct from Board identity and probe-confirmed facts (name, **Board Link**), which are structured Board fields. Examples: battery configuration, **Alert Preset** levels, **Board Top Speed**.
_Avoid_: Board config, per-board App Setting

**Release Policy**:
The app-version compatibility boundary that may identify the latest release, issue an Update Warning, impose an Online Block, or exceptionally impose an App Block.
_Avoid_: Force Update, minimum version, version warning

**Update Warning**:
A Release Policy outcome that urges an affected app version to update without changing capability availability.
_Avoid_: Online Block, update available, soft block

**Online Block**:
A Release Policy outcome that denies Online Capabilities for an affected app version while leaving local capabilities available.
_Avoid_: Warning, soft block, server block

**App Block**:
An exceptional Release Policy outcome that requires an update before normal app UI continues without ending already-running Board work.
_Avoid_: Force Update, hard block, kill switch

**Community Message**:
A server-authored, rider-facing communication that may inform, warn, or announce without changing capability availability.
_Avoid_: Release warning, push notification, server error

**Online Capability**:
An app capability that depends on the Vescape server and remains separate from local Board, recording, history, and tuning capabilities.
_Avoid_: Server feature, cloud feature, online mode

**Diagnostic Event**:
An app-observed abnormal condition that helps explain board connection, telemetry, tuning, recording, or UI failures.
_Avoid_: Error log, debug session, crash report

**Group Ride**:
A live, ephemeral, server-relayed room of **Riders** sharing **Rider Presence** so they can see each other on the live map while riding together. It has no owner and lives only while at least one Rider is present; the server reaps it when empty. Network-backed and multi-device — the first app concept that is not local-only truth. Strictly distinct from a **Ride Recording** (each Rider may still make their own private Ride Recording during a Group Ride) and from **Ride History**.
_Avoid_: Group session, room, party, ride session, group ride recording

**Rider**:
An anonymous participant in **Group Rides**, identified by a persistent device-generated id plus a rider-chosen display name. Carries no login, account, or server-side identity record, and is not a **Board**. The same person on two phones is two Riders.
_Avoid_: User, account, member, profile, friend

**Vescape Account**:
An optional online identity that never gates the app's local, offline-first capabilities or ownership of local data.
_Avoid_: Rider profile, User, Profile

**Rider Presence**:
A **Rider's** live shared snapshot within a **Group Ride**: location and heading from the phone **GPS Fix**, plus optional speed and **Battery SoC Estimate** when a **Board Session** is live. Ephemeral and server-relayed, never persisted on phone or server, suppressed while the Rider is inside a **Privacy Zone**. A Rider with no recent Rider Presence goes stale, then drops from the Group Ride.
_Avoid_: Position update, presence ping, location share, group telemetry

## Relationships

- A **Board** has at most one **Board Link**; absence means the Board is offline-only or not yet linked.
- A **Board Link** has exactly one **Board Transport**.
- A **Board Link** has one **Board Link Version**.
- A **Board Link** is only saved after a successful **Board Probe**.
- An outdated **Board Link Version** keeps telemetry available but requires re-link before firmware-dependent commands.
- A **Board Link** may include a **Board Firmware Identity** for the selected **Board Transport**.
- A missing **Board Firmware Identity** does not invalidate a **Board Link**, but it is unusual and should be visible during linking.
- A **Board Link** without **Board Firmware Identity** supports telemetry but not firmware-dependent commands.
- A re-link is the rider-initiated durable refresh of a **Board Link**; it runs a full **Board Probe** and replaces the whole link.
- A **Board Session** runs a background **Link Integrity Check** without delaying telemetry or changing the selected **Board Transport**.
- A **Link Integrity Check** verifies saved capability facts but does not discover new hardware capabilities; new capabilities require a full re-link.
- Native owns **Link Integrity Check** truth; app UI only displays the resulting state.
- A **Tune Snapshot** requires a trusted **Board Link** because tune field identity depends on the connected controller.
- A **Board Firmware Identity** may be rediscovered during a **Board Session**; any mismatch creates a **Stale Board Link**.
- A **Stale Board Link** does not end a working **Board Session**, but only telemetry remains trusted until a fresh **Board Probe** replaces the link.
- A **Stale Board Link** is latched for the current **Board Session** and is not persisted across app restarts.
- A **Firmware-Dependent Command** requires a trusted **Board Link**.
- A **Board Session** uses the stored **Board Link** and is not established for a Board without one.
- A **Board Probe** can resolve a **Board Transport** before a **Board** is created.
- A **Board Session** owns one live BLE connection to a **Board**; only Telemetry Samples received during the active session count toward live state and Ride Recording.
- A **Board** produces **Telemetry Samples** while connected.
- **Telemetry Stale** describes missing live data and is distinct from a **Stale Board Link**.
- A **Board Session** may produce a **Live BMS Series** when its **Board Link** includes BMS capability; native retains it continuously in the recent live-telemetry window (`liveHistoryLimit`) but pushes it across the bridge to JS only while the battery-detail view is focused. It is ephemeral, never persisted, and never written to **Ride Recording**. The cell **spread** scalar shown in main telemetry is not the series: it derives from the latest smart-BMS frame on the `onBms` pipe (~4Hz, always flowing), separate from the 30Hz telemetry frame.
- A **Metric Sanitizer** may create **Metric Exclusions** for values derived from **Telemetry Samples** while preserving the original samples and current live board readout.
- A **Metric Exclusion** belongs to one **Telemetry Sample** and one metric.
- A **GPS Fix** may be associated with live map state, but only GPS fixes captured alongside **Telemetry Samples** contribute to a **Ride Recording**.
- A **Map Point** is placed by a signed-in **Vescape Account** on the live map and does not belong to **Ride Recording** or **Ride History**; the server owns it, and the app reads the ones near the camera without keeping a durable copy.
- A **Map Point Reaction** belongs to one **Vescape Account** and one **Map Point**; the server derives the score from its reaction rows.
- A **Direction Point** is one rider's private navigation target, is never a **Map Point**, and stays on the phone so **Group Ride** presence can share it.
- A **Navigation** belongs to exactly one **Direction Point**: setting a Direction Point creates it and clearing one ends it, so a rider never has more than one Navigation.
- A **Navigation** is produced under one **Navigation Profile** and keeps it: choosing a different profile does not redraw the existing path, it produces a new Navigation in its place.
- A **Navigation** outlives the app process and any single **Ride Recording**: a rider who restarts, crashes, or starts riding another day finds the same Direction Point and the same path waiting.
- A **Navigation** is computed once and never changes on its own: straying from it, looping back, or riding side paths leaves it untouched, and only the rider asks for a new one.
- **Route Progress** belongs to exactly one **Navigation** and attaches to the nearest point on it unconditionally: there is no off-route state, so a rider who loops away and comes back re-attaches without asking for anything.
- **Route Progress** measures what is left along the path rather than the straight line to the **Direction Point**, and its bearing points at an aim point ahead on the path rather than at the target, so it follows the ways the path follows.
- A **Map Camera Controller** may frame **Live State**, **Ride History**, **GPS Fixes**, or **Map Points**, but does not own those domain objects.
- A **Map Camera Intent** is interpreted by the **Map Camera Controller**; outside components request camera behavior instead of mutating the map camera directly.
- A **History Camera Refinement** belongs to one selected **Ride Recording** in **Ride History** and is ignored if the selected ride changes or the rider manually browses the map.
- A **Map Camera Profile** belongs to the **Map Camera Controller** and keeps pitch zoom-derived, including removing map tilt at far zoom levels.
- A **Map Camera Profile** for compass follow preserves live follow during zoom-only gestures near the followed GPS fix, matching GPS-heading follow behavior.
- A **Map Camera Profile** for compass follow is applied only after a real compass heading is available; heading zero is not used as a placeholder for compass readiness.
- A style reload is treated as a **Map Camera Intent** that preserves the current manual camera snapshot or recomputes the active logical target without resetting heading or pitch.
- A weather view uses a **Map Camera Profile** rather than a direct zoom change; it keeps the current map center while applying a weather overview zoom and low or flat pitch.
- A **Map Camera Controller** uses **App Settings** such as map style, **Map Orientation Mode**, and perspective mode, but those settings remain durable preferences outside the controller.
- A **Privacy Zone** limits what **Ride Recording** data is retained without changing **Live State**.
- A **Ride Recording** becomes part of **Ride History**.
- A **Moving Window** belongs to one **Ride Recording** and is derived from which **Telemetry Samples** are excluded from speed metrics; a Ride Recording without one is excluded from **Ride History**.
- A **Ride History Marker** belongs to **Ride History** and may explain where a **Ride Recording** lost or regained board data.
- An **Idle Pause** belongs to one **Ride Recording**, begins after a sustained absence of moving **Telemetry Samples**, keeps the **Board Session** live at a reduced poll rate, and produces a **Ride History Marker**; its sample gap stays inside the **Moving Window** (and counts toward ride time) when it occurs between two moving spans.
- A **Favorite** is a durable time range over **Ride History**; its telemetry is pinned against deletion, and a deleted ride leaves its favorited sub-ranges intact.
- **Favorite Media** belongs to one **Favorite**, is copied into app storage, and is placed from a nearby recording-backed **GPS Fix** by capture time.
- A **Tune Snapshot** belongs to the currently connected **Board** and is read-only.
- A **Tune Profile** belongs to a **Board** and stores semantic field values independently of firmware schema.
- A **Tune Profile** also belongs to one **Tune Compatibility**; profiles from other Refloat package versions are retained but not used for the current board state.
- **Tune Compatibility** ignores Refloat suffixes or fork labels, while **Board Firmware Identity** keeps the exact reported version for link integrity.
- The first **Tune Profile** for a **Tune Compatibility** is created only after an explicit rider action.
- Offline tune editing may use the saved **Board Link** to choose the active **Tune Compatibility**, but board tune reads and writes require trusted link integrity.
- A **Tune History Entry** captures the previous state of a **Tune Profile** before each explicit save.
- A **Tune Preview** derives an idealized board-angle response from one **Tune Profile** and never predicts whether the **Board** can physically achieve it.
- A **Pitch Input** adds pitch error over time without directly commanding speed or motor power.
- A **Posi Sensor** setting belongs to a **Tune Profile** when the board firmware exposes that Refloat field.
- One current **Legal Policy** is selected automatically from the first resolvable GPS Fix, changes only on explicit refresh, and applies to every Board without per-Board snapshots.
- **Legal Mode** belongs to one **Board**, requires a resolved **Legal Policy** plus a live **Board Session** with trusted link integrity to enable, and remains enabled until explicitly disabled.
- **Legal Mode** can always be disabled, even when its Board is disconnected or no **Legal Policy** is available.
- A **Legal Warning Speed** is lower than its **Legal Speed Limit**; **Legal Road Status** may warn without removing Legal Mode.
- A **Board Move** requires a live **Board Session** but must not be treated as riding.
- **Board Move**, light controls, tune writes, and quick tune controls are **Firmware-Dependent Commands**.
- A **Board Warning** belongs to one **Board** and one problem kind; re-detection updates the existing warning instead of creating another.
- A **Board Warning** is detected natively: config-scoped detectors run once per **Board Session** after a passing **Link Integrity Check** (and after tune writes), telemetry-scoped detectors run continuously on live BMS/telemetry data.
- A **Board Warning** outlives the **Board Session** and app restarts; it clears automatically only when its detector re-evaluated with real data and the condition was gone, or when the rider clears it manually — a still-true condition re-fires it.
- A **Board Warning** firing for the first time in a **Board Session** also records one **Diagnostic Event**.
- A **Board Warning** is not an **Alert Rule** (app-authored, not rider-authored) and produces no riding feedback; it is passive display only.
- A **Board Warning** detector can be replayed offline against a **Debug Recording**'s BLE frames; a committed clean Debug Recording guards against false positives.
- An **Alert Rule** evaluates against live **Telemetry Samples**.
- A **One-Shot** or **Repeating Alert Rule** announces only while fired and needs an **Alert Re-Arm** before it can announce again; a **Geiger Alert Rule** has neither, its cadence follows **Alert Range Depth**.
- An **Alert Rule** belongs to one **Board**; the alert engine evaluates only the connected **Board**'s rules, and deleting a **Board** deletes its rules.
- An **Alert Preset** is set per metric and produces zero or more **Alert Rules** for that metric; those rules are regenerated wholesale when its level changes and coexist with the rider's manual **Alert Rules**.
- A speed **Alert Preset** resolves its km/h thresholds from **Board Top Speed**; changing **Board Top Speed** regenerates the speed preset's **Alert Rules**.
- An **Alert Message Template** belongs to one **Alert Rule**.
- A **Watch Mirror** receives **Watch Frames** and **Watch Alerts** from the phone and never sends data back; it is not a **Board**, a **Board Session**, or a source of **Telemetry Samples**.
- A **Watch Frame** is derived from **Live State** and is only pushed while a **Board Session** is producing **Telemetry Samples**.
- A **Watch Alert** is pushed when an **Alert Rule** fires on the phone and does not re-evaluate any threshold on the **Watch Mirror**.
- An **App Setting** affects app behavior and is not part of a **Tune Profile** or **Board** identity.
- A **Release Policy** may issue an **Update Warning**, impose an **Online Block**, or impose an **App Block** for affected app versions.
- An **Update Warning** does not change local or online capability availability.
- An **Online Block** denies every **Online Capability** while preserving local app capabilities.
- An **App Block** also denies every **Online Capability**, but does not end an already-running **Board Session** or **Ride Recording**.
- A **Community Message** never changes whether an **Online Capability** is available.
- A **Group Ride** is an **Online Capability**; a **Board Session**, **Ride Recording**, **Ride History**, and tuning are not.
- A **Diagnostic Event** may describe failures around a **Board**, **Live State**, **Telemetry Sample**, **Ride Recording**, or **Tune Profile** workflow.
- A **Group Ride** contains zero or more **Riders** and exists only while at least one **Rider** is present; it owns no durable truth and is never written to **Ride History**.
- A **Rider** may be in at most one **Group Ride** at a time and is identified independently of any **Board**.
- A **Vescape Account** is independent of a **Rider** and may enable optional online services such as backup, sync, or paid entitlements, but is not required to use local Boards, Ride Recording, Ride History, or tuning.
- A **Rider Presence** belongs to one **Rider** in one **Group Ride**, derives location from a **GPS Fix** and optional speed/**Battery SoC Estimate** from a live **Board Session**, and is not produced while the Rider is inside a **Privacy Zone**.
- A **Group Ride** requires only a phone **GPS Fix** to join; a **Board Session** is optional and only enriches a **Rider Presence**, never gates it.

## Example Dialogue

> **Dev:** "If GPS is active but no board is connected, should that create a Ride Recording?"
> **Domain expert:** "No. Standalone GPS can update the live map, but a Ride Recording requires board telemetry from a connected Board."

> **Dev:** "If the board's tune changed outside the app, what happens when the user connects?"
> **Domain expert:** "The app reads a Tune Snapshot and compares it against the Tune Profile. Changed fields show old and new values with per-field revert. User decides: accept board values into the profile, or push the profile to the board."

> **Dev:** "Can I edit a Tune Profile without a connected board?"
> **Domain expert:** "Yes. Editing and saving is local. Pushing to a board requires a live connection — the app must read the full config blob first to preserve unknown fields."

> **Dev:** "Does someone need to sign in before connecting a Board or recording a ride?"
> **Domain expert:** "No. A Vescape Account is optional; local board and ride features remain available offline."

> **Dev:** "If an Online Block applies to this app version, does the rider lose access to their Board?"
> **Domain expert:** "No. Only Online Capabilities such as Group Ride are unavailable; local Board and ride capabilities remain available. An exceptional App Block may hide normal app UI, but it still does not end already-running Board work."

## Flagged Ambiguities

- "device" may mean the phone BLE peripheral, the saved app board, or the motor controller; resolved term: use **Board** for the saved rideable device.
- "scan" may mean BLE discovery or telemetry validation; resolved term: use **Board Probe** for the pre-save telemetry check after selecting a BLE peripheral. UI copy says "linking" for this; code/domain keep "Board Probe".
- "paired" may mean a selected BLE peripheral or a Board that is ready to connect; resolved term: use **Board Link** for the saved, probed reachability details.
- `bleId` without a **Board Transport** is an invalid partial **Board Link**; resolved: save the whole **Board Link** or none of it.
- "firmware mismatch" may sound like a failed connection; resolved term: use **Stale Board Link** when telemetry still works but saved probe facts need re-linking.
- "board hardware or firmware changed" is rider-facing copy for a **Stale Board Link**.
- "board link needs update" is rider-facing copy for an outdated **Board Link Version**.
- "stale" may mean missing telemetry or mismatched link facts; resolved terms: use **Telemetry Stale** for missing samples and **Stale Board Link** for a link integrity mismatch. Code may call the latter `mismatched`.
- "Refloat version" may mean firmware version, package version, or tune schema version; resolved term: use **Board Firmware Identity** for probe-confirmed controller identity, with Refloat package version as one possible detail.
- "fw version" is too vague for rider-facing language; resolved terms: use VESC firmware version for VESC identity and Refloat package version for Refloat identity.
- "session" may mean a BLE connection, raw debug capture, or persisted ride; resolved terms: use **Board Session** for the live BLE connection lifecycle and **Ride Recording** for the persisted ride capture. Avoid bare "session".
- "error" may mean crash, handled failure, UI message, or diagnostic clue; resolved term: use **Diagnostic Event** for app-observed abnormal conditions worth reviewing.
- "telemetry marker" names the storage table, but map-visible history annotations are **Ride History Markers**.
- "point" may mean a GPS coordinate, route coordinate, history annotation, or user-authored map location; resolved term: use **Map Point** for user-authored map locations.
- "map manager" may mean camera orchestration, map style selection, layer visibility, or map data ownership; resolved term: use **Map Camera Controller** for camera orchestration only.
- "camera command" and direct method-style names obscure who chooses the final camera; resolved term: use **Map Camera Intent** for requests handled by the **Map Camera Controller**.
- "route correction" sounds like changing Ride History data; resolved term: use **History Camera Refinement** for camera-only retargeting from approximate to exact ride framing.
- "tilt setting" is too narrow because pitch depends on zoom, heading, padding, and view intent; resolved term: use **Map Camera Profile**.
- "filter" may mean dropping samples, smoothing charts, or excluding implausible values from metrics; resolved term: use **Metric Sanitizer** for metric exclusion that preserves original samples.
- "save area" or "safe area" may mean a privacy boundary around home or work; resolved term: use **Privacy Zone**.
- "navigation mode" may mean how the map camera is oriented or guidance toward a destination; resolved term: use **Map Orientation Mode** for camera orientation and reserve "navigation" for destination guidance.
- "smoother" is avoided in the raw-telemetry layer (see **Metric Sanitizer**) but is legitimate for the **Battery SoC Estimate**, a processed derived value that smooths the percentage only — never the raw voltage **Telemetry Sample**.
- "BMS telemetry" may mean live smart-BMS cell values or a durable battery-health archive; resolved: use **Live BMS Series** for the ephemeral in-memory cell-voltage window (retained by `liveHistoryLimit`, never persisted), distinct from scalar **Telemetry Samples**. No durable BMS/battery-health store exists; if one is ever added it needs its own term and a rest-normalized capture trigger.
- "pause" may mean stopping the **Board Session** versus temporarily halting sample persistence; resolved: **Idle Pause** halts **Ride Recording** sample persistence only — the **Board Session** stays connected and live at a reduced poll rate.
- "ride" may mean a personal persisted capture or a live shared room; resolved terms: use **Ride Recording** for the local persisted capture and **Group Ride** for the live shared room. The two are independent — a Rider can do either, both, or neither.
- "presence" / "location share" may mean a one-off map dot or the live group feed; resolved term: use **Rider Presence** for what a **Rider** shares into a **Group Ride**.
- "account", "profile", and "Rider" were used interchangeably; resolved: a **Vescape Account** is optional online identity, while a **Rider** remains an anonymous device-local Group Ride participant.
- "force update" was used to mean both denying server compatibility and locking app UI; resolved terms: use **Online Block** for denying **Online Capabilities** and **App Block** for the exceptional update-only UI state.
- "version warning" was used for both an update prompt and denial of server features; resolved terms: use **Update Warning** for the non-blocking prompt and **Online Block** when **Online Capabilities** are denied.
- "message" may mean version compatibility or general communication; resolved: compatibility belongs to the **Release Policy**, while a **Community Message** never changes capability availability.
- "posi switch" and "dual switch" refer to **Posi Sensor** mode in rider language; the firmware field name is an implementation detail.
- "move board" may mean **Remote Tilt** or motor movement while disengaged; resolved term: use **Board Move** for deliberate app-driven movement of a disengaged Board.
