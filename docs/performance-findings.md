# Performance Findings — Live Telemetry

## Problem

JS thread lag >300ms when accumulating 10 minutes of live telemetry history. Occurred regardless of whether sparklines or live status bar were visible.

## Root Cause Analysis

### 1. Dev-mode overhead (46% of CPU)

React DevTools profiling (`structuredCloneInternal` + `reportMeasure`) consumed nearly half the JS thread budget. This disappears entirely in production builds.

### 2. Per-component metric projection (fixed)

Old approach: `projectLiveMetricHistory()` created 12 typed arrays every 1Hz publish, stored in zustand state. Each card component received full history object and picked its slice — but zustand still diffed the entire object on every update.

### 3. Double-render from useSyncExternalStore (fixed)

Intermediate attempt used `useSyncExternalStore` for metric data. Problem: `useSyncExternalStore` triggers synchronous re-renders that cannot batch with zustand updates. Components rendered twice per publish cycle.

## Architecture (current)

```
Native events → liveTelemetryRuntime (mutable buffer + SharedValues)
                    │
                    ├── SharedValues → Reanimated UI (gauge needles, animated text)
                    │                  No React render needed
                    │
                    └── 1Hz timer → zustand set({ metricVersion, liveStatus, liveLocationHistory })
                                        │
                                        └── useLiveSeries(key) → center sparklines
                                            Reads the natively-decimated `onLiveSeries`
                                            store (~1Hz). No JS-thread projection.

Native (focused)  → onFocusedSeries (per focused metric, fixed-width buckets)
                        └── useLiveMetric(selector) → focusedSeriesStore
                            `/control` detail charts only; native decimates,
                            JS just maps the flat series to points.
```

### Key design decisions

| Decision                                            | Why                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Mutable buffer, not zustand state                   | Avoid creating new arrays every sample. Buffer holds ~6000 items at 5min window.             |
| Module-level projection cache                       | Multiple cards use same buffer. Project once per selector per frame, not once per component. |
| Version counter in zustand                          | Single primitive selector. All metric consumers batch into one React render pass.            |
| SharedValues for real-time display                  | Speed gauge, duty %, temps update at full telemetry rate (~20Hz) without React renders.      |
| 1Hz publish rate (`LIVE_HISTORY_PUBLISH_MS = 1000`) | Charts don't need faster updates. Keeps React render budget low. Do not decrease this value. |

## Performance characteristics

| Metric                                        | Value                          |
| --------------------------------------------- | ------------------------------ |
| Buffer size at 5min/20Hz                      | ~6000 telemetry samples        |
| Projection cost (single selector, 6000 items) | <1ms                           |
| React renders per publish                     | 1 batch (all metric consumers) |
| SharedValue updates                           | ~20/sec, zero React cost       |
| Production JS lag (10min history)             | <50ms                          |

## What NOT to do

- **Don't store projected arrays in zustand** — creates new refs every publish, triggers diffing on large objects.
- **Don't use `useSyncExternalStore` alongside zustand** — causes double renders because sync external store fires outside React's batching window.
- **Don't reduce `LIVE_HISTORY_PUBLISH_MS`** — 1Hz is sufficient for charts. Lower values multiply render cost without visual benefit.
- **Don't iterate buffer per-component** — always use the shared projection cache.
- **Don't trust dev-mode profiling numbers** — React DevTools adds 40-50% overhead. Always verify perf issues exist in production builds before optimizing.

## General rule: high-frequency streams never drive React state

The telemetry hot/cold split ([ADR 0013](adr/0013-fast-telemetry-hot-cold-split.md)) is a specific case of a rule that holds for **every** high-frequency source in the app — telemetry, GPS, magnetometer/heading, and Group Ride presence:

- A source faster than ~a few Hz **must not** call `setState` / bump a Zustand slice per sample. Route the hot value to a Reanimated SharedValue (zero React render) and publish a coalesced cold snapshot at ~1Hz for anything that needs to re-render.
- Rule of thumb: **nothing should re-render a screen subtree more than ~5×/second.** Sustained higher-rate rendering pins the JS thread + GPU and overheats the device.

### Why this rule exists (regression that motivated it)

The Compass (`phoneHeading`) map mode wired the ~30Hz `DeviceMotion` magnetometer straight into `setState` inside `MainMap`, re-rendering the whole map subtree 1:1 (~24 renders/sec) even while parked. Result: device overheated fast → suspected iOS `WatchdogTermination`. Fixed by disabling the mode (see issue #183) and adding the guard below.

### The guard: `useRenderRateWarning`

`src/hooks/useRenderRateWarning.ts` is a dev-only canary — it `console.warn`s when a wired component commits more than 5 renders/second (no-op in production). Place it as a **tripwire at stream boundaries**, not on every component. Currently wired into `MainMap`, `BottomTelemetryStrip`, and `GroupRideWidget` — the three roots that consume live streams. If a warning fires, a stream has leaked into React state; move it to a SharedValue / cold-path publish.

## Files

| File                                       | Role                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `src/telemetry/liveTelemetryRuntime.ts`    | Mutable buffer, SharedValues, version counter, snapshot publishing   |
| `src/telemetry/liveMetricHistory.ts`       | Buffer ops: insert, prune, dedup, summarize                          |
| `src/modules/board/hooks/useLiveMetric.ts` | Detail-chart hook: focuses a metric, reads the native focused series |
| `src/modules/board/store/bleStore.ts`      | Zustand store, 1Hz publish timer, event subscriptions                |
| `src/hooks/useRenderRateWarning.ts`        | Dev-only render-rate canary; tripwire at stream boundaries           |
