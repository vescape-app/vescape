# Performance Findings — Map Camera (Compass Mode)

Second act of the Compass-mode story. The first act — the ~30Hz magnetometer wired straight into
`setState` — is in [performance-findings.md](./performance-findings.md) (#183). This one is about
what the camera write itself costs after React is out of the way.

## Problem

Compass mode killed the app on iOS (#420). Ride, lock the phone, unlock: the app is frozen and dies.
The FrontBoard scene-update watchdog allows 10s of wall clock; the profile showed **11.64s**.

## Root cause

Backgrounding does not stop the loop. `UIBackgroundModes` (`bluetooth-central`, `location`) keeps the
JS thread and CoreMotion running while the screen is off, so the heading sensor kept driving camera
writes at 60Hz against a map that nobody could see. `requestAnimationFrame` _does_ pause — it is
CADisplayLink-backed — but nothing else does, so the writes queued rather than stopped, and unlocking
paid the whole backlog on the main thread at once.

Attribution of main-thread samples inside `CameraManager::setCamera` (56.4% of the thread):

| share | what                                                    |
| ----- | ------------------------------------------------------- |
| 46%   | building the `onCameraChanged` event payload dictionary |
| 8.6%  | compass ornament `UIView.animate`                       |
| 5.2%  | `coordinateBounds` unprojection                         |
| 2.3%  | needle transform                                        |

Two non-obvious mechanics behind that table:

- **`setCamera` fires `onCameraChanged` synchronously.** The JS event payload is built _inside_ the
  camera write, so every frame pays for it — it is not deferred work.
- **A hidden compass ornament still costs.** `MapboxCompassOrnamentView.currentBearing` commits a
  `UIView.animate` + `CGAffineTransform` per bearing change with no visibility guard, so
  `compassEnabled={false}` does not avoid it.

## Fixes

- **Perceptual frame skipping** in `cameraEngine/engine.ts`: a frame that moves the camera less than
  the emit epsilons is not written at all. `emit(..., { force: true })` exists for the landing frame
  and the post-landing hold, which must overwrite a native fling animator that outlives the springs.
- **Foreground gating** via `useAppActive` — the sensor subscription stops when the app is not the
  foreground app. `inactive` counts as away.
- **No `bounds` in the `cameraChanged` payload** (Mapbox patch, both platforms; `mapIdle` still
  carries it). See [agents/mapbox-patches.md](./agents/mapbox-patches.md).
- **30Hz sensor**, with smoothing alpha and dead band rescaled so the wall-clock time constant and
  jitter rejection are unchanged.

## Results

Measured on iPhone SE (3rd gen), iOS 26.6, Release build — see
[agents/ios-profiling.md](./agents/ios-profiling.md) for the harness.

|                                    | before                  | after                    |
| ---------------------------------- | ----------------------- | ------------------------ |
| `setCamera`, share of main thread  | 56.4%                   | 7.5%                     |
| Severe Hangs                       | 2 (8.41s, 11.64s)       | 0                        |
| worst hang                         | 11.64s → process killed | 368ms microhang          |
| main-thread samples/s while locked | foreground rate         | 17/s vs 236/s foreground |

Backgrounded camera writes are reduced, not zero: ~7/s remain, driven through `setCameraDirect` by
GPS follow, which keeps running under the `location` background mode by design.

## What NOT to do

- **Don't assume backgrounding stops a sensor loop.** It stops `requestAnimationFrame` and nothing
  else. Anything that exists only to be looked at gates on `AppState`; anything that must survive a
  locked phone belongs in native.
- **Don't smooth per sample without rescaling to the interval.** An EMA alpha is rate-coupled —
  halving the sample rate needs `alpha' = 1 - (1 - alpha)²` to hold the same time constant. The dead
  band scales too, or it stops rejecting jitter at the same degrees per second.
- **Don't treat `setNativeProps` on a `ShapeSource` as a property poke.** It is a full source
  replacement: JSON → parse → `setGeoJSON` → re-tile.
- **Don't remove the per-frame camera echo to JS** without replacing what depends on it. It is the
  deliberate single writer for the off-screen indicators, with its own regression history.

## Files

| File                                                  | Role                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| `src/modules/map/lib/cameraEngine/engine.ts`          | Spring engine; emit epsilons and the `force` escape hatch     |
| `src/modules/map/lib/phoneHeading.ts`                 | Sensor interval, smoothing alpha, dead band, max step         |
| `src/modules/map/components/PhoneHeadingMapLayer.tsx` | DeviceMotion subscription, foreground gate, cone shape writes |
| `src/hooks/useAppActive.ts`                           | Foreground predicate                                          |
| `patches/@rnmapbox%2Fmaps@10.3.2.patch`               | `includeBounds` on the camera-changed payload                 |
