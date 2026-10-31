---
name: react-perf
description: Diagnose and fix React Native performance problems (laggy gestures, render storms, janky live-data UI) using Reanimated shared values, worklets, and zero-re-render patterns.
---

# React Native Performance

Playbook for live-data / gesture-heavy RN screens. Learned the hard way on live telemetry charts + scrubbing.

## Diagnose first, in this order

1. **Add a render canary** before optimizing. A `useRenderRateWarning(label)`-style hook (count commits per second in an effect, `console.warn` above threshold, dev-only) tells you _which_ component re-renders and how often. Don't guess.
2. **Ask: which thread is the bottleneck?**
   - Cursor/gesture lags finger → gesture runs on JS thread and JS is busy. The gesture pipeline is the problem, not the rendering.
   - Values update slowly/stutter → React re-render storm; find the setState/subscription firing per event.
3. **Compare with a screen that feels fast** and diff the data paths. A screen with _more_ data can be smoother because its data is static and its touch path never enters JS.

## Core rules

- **No JS in the touch path.** `PanResponder` = every move crosses to the JS thread and queues behind everything else. Use `react-native-gesture-handler` `Gesture.Pan()` worklets writing SharedValues. `runOnJS` only at gesture start/end, never per move.
- **Precompute a lookup table for gestures.** Build a marker table (times, x positions, preformatted value strings) on JS once per data change; worklet does binary search per move. Never format strings or search raw data per gesture sample.
- **Freeze live series during a drag.** Live streams mutating chart props mid-gesture rebuild paths/tables while the user scrubs. Snapshot data on gesture grant, restore on release.
- **Text without re-renders**: non-editable `TextInput` + `useAnimatedProps` (`{ text, value, defaultValue }`) driven by a derived string. Bars/colors: `useAnimatedStyle`.
- **React renders skeleton only.** Row count / structural changes go through state; every per-frame value goes through shared/derived values.

## Store → UI thread bridging (the traps)

- **Do NOT push native event objects or large nested arrays into SharedValues.** Reanimated shareable conversion deep-clones on every write; large frame arrays = main-thread stalls; native-module event objects can come out mangled (garbage values).
- **Reduce on JS, ship results.** Compute summaries from plain store data on JS (correct + cheap), write only the small result object to the SharedValue.
- **History/scrub data crosses as flat number arrays** (`times: number[]`, `values: number[]`, `count`). Cheap to convert, impossible to mangle; worklet rebuilds the record it needs from lanes.
- **Never compare against `sharedValue.value` for change detection.** Read-back returns a converted copy — `!==` always true → you re-serialize on every event. Keep the last-seen JS reference in a closure variable.
- **Subscribe outside React** (`store.subscribe`) to feed SharedValues; guard each field with its own closure-ref check so unrelated store traffic is free.
- **Zustand selectors:** return primitives or stable refs. A selector returning `array.length` re-renders only on change; cursor-aware selectors returning a stable historical object ref make live appends free.

## Anti-patterns seen in the wild

- `useAnimatedReaction` → `runOnJS(setState)` per gesture sample → full subtree re-render at 60/s.
- Throttling state updates to "fix" render rate → UI visibly lags behind the gesture. Fix the architecture, not the rate.
- Subscribing a component to a whole streaming array for a derived stat → re-render per append. Compute the stat in the subscription and ship the result.

## Project conventions (this repo family)

- Worklet-shared pure functions live in `src/lib/`, marked with `'worklet'` (inert in plain JS/tests). Only mark what worklets actually call.
- Gesture factories = module-level plain functions (`createXxxGesture({ sharedValues, callbacks })`) — keeps `react-hooks/refs` lint happy; component wraps the call in `useMemo`.
- Formatter: `bun fmt` (`bun run format`). Never run bare `prettier` — no config, it mangles the file style.
