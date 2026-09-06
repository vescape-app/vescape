# Watch Mirror as a config-plugin-injected native companion

The app needs a **Watch Mirror** — a wrist app that shows live board state (speed, duty, battery, temps) and plays alert feedback. A Wear OS app (and later a watchOS app) is a standalone _native companion target_, not an Expo module and not React Native: it compiles inside the generated native project and ships as its own form-factor artifact. Because `android/` and `ios/` are Expo-generated and gitignored, the companion's durable source cannot live there. We keep it as git-tracked native source under root `watch/` and inject it into the generated project with a config plugin — the same pattern as `plugins/withGradleJvmArgs.ts` — so we never eject and `prebuild` stays reproducible.

## Decision

- **Watch apps are native companions, not Expo modules.** Durable source lives at root `watch/`, one subdirectory per platform: `watch/wearos/` (Kotlin + Compose for Wear, Android) and, in the future, `watch/watchos/` (SwiftUI, Apple Watch). They are explicitly _not_ under `modules/`, which is Expo-module / autolinking territory.
- **A config plugin injects them on `prebuild`.** `plugins/withWearMirror.ts` copies `watch/wearos/` into `android/` and registers the Gradle module (`include ':wearos'` in `settings.gradle`). It does not add the obsolete `wearApp` dependency. Google Play receives separate phone and Wear AABs under the same `app.vescape` listing and delivers each through its form-factor tracks. A future `withWatchMirror.ts` does the analogous Xcode-target injection for `watch/watchos/`.
- **The phone-side push lives in `modules/vescape-core`, not in the watch module.** Telemetry truth flows through `CoreForegroundService`, so the bridge sits next to it and never round-trips through JS: a dedicated **watch tick** (configurable interval, default ~500 ms) reads the cold-path snapshot (ADR-0013) and pushes a **Watch Frame** via `MessageClient`; the native alert engine pushes a **Watch Alert** when an Alert Rule fires. On iOS this becomes `WatchConnectivity` on the same side of the bridge. `vescape-core` owns both phone-side pushes; `watch/` owns both wrist apps.
- **One-way and capability-gated.** The Watch Mirror sends nothing back. (Amended by ADR-0033: _state_ stays one-way, but the wrist may send rider _commands_.) The phone pushes only when a Watch Mirror is actually reachable (a declared `CapabilityClient` capability — not merely a paired watch). The watch self-detects disconnection by Watch-Frame timeout and greys out on the in-frame `stale` flag.
- **The wait is named, not anonymous.** During a session's connect phase (no board telemetry yet) the tick pushes a **waiting frame** (flags-byte `waiting` bit, empty lanes, also flagged `stale` so older decoders degrade to a dimmed zero) and the wrist shows "board connecting". When no frames arrive at all, the wrist derives a watch-local `PhoneLink` (no phone link / phone-app capability absent / app reachable but not riding) from `NodeClient` + a `vescape_phone_app` capability the phone app advertises via `vescape-core` resources — reads only, still one-way. The phone-side presence flag is re-derived periodically (not just at session start) so a watch whose Bluetooth link was down at connect starts receiving frames once it returns.

## Consequences

- `watch/` source survives `prebuild`; the generated `android/`/`ios/` stay disposable. The injection step is custom (no off-the-shelf Expo plugin embeds a whole Gradle application module), so `withWearMirror.ts` is load-bearing and must be kept in step with the watch module's package name and Gradle layout.
- Dev builds install directly with `adb`. Store builds publish `:app` to mobile tracks and `:wearos` to dedicated Wear OS tracks; Play owns install and update delivery.
- The native data path stays single-homed in `vescape-core`: the watch is a fourth consumer of the cold-path snapshot alongside native alerts, SharedValue gauges, and the JS bridge — no new hot-path cost, no JS dependency for the wrist to keep updating while the app is backgrounded.

## Considered Options

- **Put the watch app under `modules/wear/android`.** Rejected: `modules/` is scanned by Expo autolinking for `expo-module.config.json` and linked into the phone app. The watch app is a standalone companion application, not an autolinkable library — placing it there misleads autolinking and every future reader about what it is.
- **Embed the Wear APK with Gradle's legacy `wearApp` dependency.** Rejected: current Play delivery uses a separate signed AAB and dedicated Wear OS tracks. Embedding couples phone packaging to an obsolete delivery path and hides the Wear artifact from independent review and rollout.
- **Eject and hand-maintain `android/`/`ios/`.** Rejected: forfeits reproducible `prebuild` and the rest of the Expo config-plugin pipeline for the whole app, to host one companion module.
- **Send telemetry to the watch from JS.** Rejected: JS is not running when the app is backgrounded mid-ride, but `CoreForegroundService` still has live telemetry. The push must originate native, where the truth already is.
- **`DataClient` for telemetry streaming.** Rejected for v1: it dedupes and coalesces high-frequency updates and is documented as unsuitable for streaming, which would also corrupt rate stress-testing. `MessageClient` (fire-and-forget, latest-wins) fits a continuous frame stream and latency-critical alerts.
- **Echo spoken `Alert Message Template` text to the watch (Wear TTS).** Deferred: the phone already speaks templates; the watch buzzes and tones. Wear OS TTS (voices, locale, asset delivery) is disproportionate for v1.

## Deferred (considered, postponed)

- A single `DataClient` "last frame" key so a watch waking from sleep shows the last reading instead of a blank dial until the next tick.
- An explicit "session ended" message for instant disconnect transition (timeout-based detection covers crash/out-of-range cases the message cannot, so it is required regardless).
- watchOS Mirror and `withWatchMirror.ts`.
