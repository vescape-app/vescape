# Group Ride as a server-relayed, native-owned presence pillar

Current implementation note, 2026-09-29: iOS Group Ride now exists (`modules/vescape-core/ios/groupride/`), so the iOS deferral below is historical. Rider Presence also carries motor and controller temperatures, phone battery, Board name and the Direction Point. ADR-0039 adds the Group Ride Frame that shows the Group Ride on the Watch Mirror.

The app needs **Group Rides** — live, ephemeral rooms where nearby **Riders** share **Rider Presence** (location + heading, plus optional speed and **Battery SoC Estimate**) so they can see each other on the live map while riding together. This is the first app concept that is **not local-only truth**: it requires a network, multi-device relay, and rider identity, none of which existed. The app was 100% local-first (BLE board + phone GPS + local storage). Group Ride adds a single new pillar — a relay server and a native network client — without disturbing the rest of the local-first model.

The durable, long-lived work (the WebSocket connection and the location pushes that must continue while riding with the screen off) lives in **native**, alongside `CoreForegroundService` / `GpsMonitor`, per the project's law that native owns durable truth and long-lived work while JS renders state and sends intents. JS owns only the **Social panel** UI and join/leave intents.

## Decision

- **A dedicated bun relay server, hosted on Railway, holds Group Ride state in memory only.** No database. Rooms and their Rider Presence live in a process `Map`. On restart, clients reconnect and re-announce, and rooms rebuild naturally. The server is a relay and a registry, not a system of record — consistent with **Group Rides** owning no durable truth.

- **Riders are anonymous.** Identity is a persistent device-generated id plus a rider-chosen display name, stored locally and sent to the server. No login, no account, no server-side identity record. The server trusts what clients send.

- **Group Rides are fully autonomous rooms.** No owner. A room lives while at least one **Rider** is present and is reaped when empty. Any Rider may join or leave at any time; a **Rider** is in at most one Group Ride at a time (joining leaves the current one). Optional custom name on create, auto-name fallback (`"<name>'s ride · N riders · <dist>"`).

- **The network client lives in the native foreground service.** The WebSocket and the location push are native (Android first, in `modules/vescape-core` next to `CoreForegroundService`), and the client opens the relay's dedicated `WS /ws/group-rides` endpoint. It is fed by the existing board-less GPS source `CoreForegroundService.startGpsMonitoring()` / `GpsMonitor` — already used to put "you" on the map without a **Board Session**. A Group Ride therefore needs only a phone **GPS Fix** to join; a live **Board Session** is optional and only enriches the **Rider Presence** with speed and **Battery SoC Estimate**. While **joined**, the Rider pushes Rider Presence at **1 s** (free — `GpsMonitor` already ticks at `GPS_PROVIDER` `minTime = 1000L`).

- **Discovery is push-driven and filtered client-side; only creators/joiners send location.** The server pushes Group Ride lifecycle events (`ride-created`, `ride-updated`, `ride-ended`) to every connected client, and sends an active-ride **snapshot** on connect followed by deltas. Each client computes distance **locally** against its own GPS (never sent while merely observing) and highlights the Social button when any Group Ride is within **20 km**. Tapping "New group ride" fans out `ride-created` instantly, so nearby Riders' Social button lights up immediately. Location leaves the device **only** when creating a Group Ride or while joined and pushing **Rider Presence**.

- **Public riding auto-groups on the server.** The Group Ride header switch sends `create` with `auto: true`: the relay joins the nearest active Group Ride within 10 km, and creates one only when none is in range. The relay serializes auto creates, so Riders who switch on side by side land in the same ride instead of each creating one. Switching off leaves. Turning the switch on is the Rider's opt-in to be discovered, the same as creating a ride by hand.

- **Privacy Zones suppress Rider Presence.** While a Rider is inside a **Privacy Zone**, Rider Presence is not broadcast (the dot freezes/hides for the group, resumes on exit), reusing the native zone check already in the location path — consistent with ADR-0009. Observing never sends location at all, so it needs no zone gating.

- **Stale handling is server heartbeat + WS close.** A Rider with no recent Rider Presence greys after ~5 s and drops from the Group Ride after ~30 s or on clean disconnect/leave.

- **The Social panel repurposes the profile route.** The profile entry becomes a Social panel (rider name, nearby Group Rides with one-tap join/create, and — when joined — the live roster: name, distance, speed, SoC, plus leave). The existing profile ride-stats grid is kept as a section/tab, not deleted. Other Riders render on the existing `@rnmapbox/maps` map as colored dots with name + heading, greyed when stale, tap-to-focus in the roster.

## Consequences

- The app gains its first server dependency and its first always-on socket. The observe connection lives in the native service and receives lifecycle pushes (ride-created/updated/ended). Observing runs as a plain (non-foreground) service — Android's `remoteMessaging` foreground-service type was not appropriate (it is reserved for VoIP/SMS handover) and `FOREGROUND_SERVICE_REMOTE_MESSAGING` was rejected by Play Store policy. The persistent foreground-service notification is shown only when a **Board Session** is active or GPS ride recording is running, not for pure observing.
- No new runtime permission is required: the location-type foreground service already obtains screen-off location without `ACCESS_BACKGROUND_LOCATION`, because it is started while the app is foregrounded. Auto-share without opening the app (background-initiated) would need that permission and is explicitly out of scope.
- In-memory server state means a Railway restart drops all rooms; clients recover by reconnecting and re-announcing. Acceptable for the ephemeral model.
- Global fan-out of lifecycle events to all connected clients is simple and fine at PoC scale; if it grows, the fan-out must be geo-sharded. Group Ride locations are visible to all observers — accepted, since creating a Group Ride is an explicit opt-in to be discovered.
- Anonymous, unauthenticated identity means clients can spoof ids and locations and spam rooms. **Security is deferred for the PoC** and documented here as a known gap; a shared secret or real validation is the next step if Group Ride ships beyond a trusted circle.
- iOS is deferred: the board-less GPS + WS path exists only on Android (`GpsMonitor`); the Swift equivalent (`CLLocationManager` background mode in `VescapeCoreModule.swift`) is required before iOS parity.

## Considered Options

- **Managed realtime backend (Supabase Realtime / Ably / Firebase).** Rejected for this PoC in favor of a self-owned bun server on Railway: full control over the relay protocol and no third-party realtime dependency, at the cost of owning deploy.
- **Peer-to-peer / local mesh (BLE / Wi-Fi-direct / UDP).** Rejected: literally matches "everyone close by" but NAT traversal, discovery, and range make it unreliable, and a rendezvous server would be needed anyway.
- **JS-owned WebSocket.** Rejected: the OS throttles/kills JS when backgrounded, so sharing would stop the moment the screen sleeps — useless for real rides. The client must be native, where `CoreForegroundService` already keeps location alive.
- **Server-side geo-subscription (client sends location, server filters nearby).** Rejected in favor of server-pushes-events + client-filters-locally: observers then never send location at all (a privacy win), the server stays a dumb fan-out, and distance math reuses the GPS already running. The earlier "always send observe location" tradeoff is eliminated.
- **Persisted server state (Postgres/SQLite).** Rejected: Group Rides own no durable truth; in-memory matches the ephemeral model and avoids infra.
- **Requiring a Board Session to join.** Rejected: blocks spectators and phone-only riders; phone **GPS Fix** is enough, telemetry only enriches.

## Deferred (considered, postponed)

- Authentication / anti-spoofing / rate limiting (shared secret first, real identity later).
- iOS Group Ride (Swift GPS + WS + background location).
- Push notifications for nearby Group Rides (current scope is only the highlighted Social button while connected).
- Background-initiated discovery without opening the app (would need `ACCESS_BACKGROUND_LOCATION`).
- Privacy-Zone gating of observe location (moot today, since observing sends no location; revisit only if discovery ever becomes server-filtered).
- Per-room rider cap and geo-sharded fan-out (no cap for the PoC).
