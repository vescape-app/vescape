# Skia

Rules for writing `@shopify/react-native-skia` code in this repo — charts, gauges, overlays,
anything drawn on a canvas and driven by touch.

They come out of building `src/components/charts/line/` (the zoomable telemetry chart) and
replacing the chart before it. Most of them are not guessable from the Skia docs; each one below
cost a visible bug or a dropped frame first.

For React Native conventions generally see [`react.md`](./react.md). For why high-frequency
telemetry never drives React state, see
[`docs/performance-findings.md`](../performance-findings.md) — a different problem (render
pressure), same underlying rule: the UI thread owns anything that moves at touch or sensor rate.

## What a frame costs

### Mapper count, not the work inside one

The cost of a gesture frame is the number of `useDerivedValue` mappers that wake up, far more
than what any single one computes. Scrubbing the chart woke about 25 (a value, a dot position and
a text per series, per chart) and felt laggy at 9k samples; collapsing them into one worklet that
returns a struct for the whole stack made it smooth, with the same arithmetic inside.

```tsx
// ✅ One mapper for the stack, consumers read their slice
const readout = useDerivedValue<StackReadout>(() => {
  /* every chart, every series */
})
const rowText = useDerivedValue(() => readout.value.charts[chart]?.rows[index] ?? '')

// ❌ A mapper per series per chart, each resolving the viewport again
const value = useDerivedValue(() => sample(paths, scrubTimeMs.value))
```

The second reason to collapse is correctness: Reanimated schedules each derived value
independently, so separate mappers can disagree for a frame — a dot next to a number from the
moment before. Anything that must be decided once for the whole screen (which side the tooltips
flip to, where a shared cursor sits) can only be decided in a mapper that sees everything.

### Animate transforms; never geometry or shaders

A changing rect `width`, or a `LinearGradient` whose `start`/`end` are shared values, makes Skia
rebuild geometry or a shader every frame. A `Group` transform is a matrix.

```tsx
// ✅ Slide a fixed-size rect; stretch a fixed gradient
<Group transform={dimTransform}>
  <Rect x={0} width={plotWidth} height={height} color={DIM} />
</Group>
<Group transform={glowTransform /* translateX + scaleX */}>
  <Rect x={0} width={1} height={height}>
    <LinearGradient start={vec(0, 0)} end={vec(1, 0)} colors={GLOW} />
  </Rect>
</Group>

// ❌ Rebuilds the shader twice a frame
<Rect x={leftX} width={leftHalfWidth} height={height}>
  <LinearGradient start={leftGlowStart} end={leftGlowEnd} colors={GLOW} />
</Rect>
```

A one-unit-wide gradient scaled to fit is the general trick: the shader is built once and the
range it covers becomes part of the matrix.

### Quantise touch input

Touch samples arrive faster than the display refreshes and carry sub-pixel movement. A move too
small to change a pixel should not wake the layer.

```ts
const clamped = Math.round(rawX * 2) / 2
if (clamped === lastX.value) return
lastX.value = clamped
```

### One path per group, not a node per item

Hundreds of annotations are a handful of `Path` nodes when they are grouped by what they share —
colour and placement — and each group builds one path in one worklet. Skip anything outside the
viewport while building it.

### Colour by value belongs in a gradient

If colour is a function of value and value maps to a fixed y, the whole colour scale is one
vertical `LinearGradient` over the plot: it is invariant under pan and zoom, so it is resolved
once per render on the JS thread and never touched again. The old chart rebuilt a gradient stop
per sample on every frame, which made the speed line the expensive series to draw.

## Traps

### A Group applies its own transform to its own clip

`clip` and `transform` on one node means the clip window is evaluated in the transformed space.
Nest them instead — clip on the outer node in canvas coordinates, transform on the inner one.

```tsx
// ✅
<Group clip={{ x: plotX, y: top, width, height }}>
  <Group transform={[{ translateX: plotX }]}>{children}</Group>
</Group>

// ❌ Clip lands one gutter-width to the right
<Group clip={{ x: plotX, ... }} transform={[{ translateX: plotX }]}>{children}</Group>
```

### A repaint paints the tree as it stands

Skia repaints when a shared value changes, and paints the element tree at that moment. If a
change touches both a shared value and an ordinary React prop — new data means a new path _and_ a
new gradient — the repaint the path schedules can land before React has committed the prop, and
the new line is drawn with the old shader until something else repaints it.

Ask for one more frame after the commit:

```tsx
const repaint = useSharedValue(0)
useEffect(() => { repaint.value += 1 }, [gradient, repaint])

const path = useDerivedValue(() => {
  // Reading the counter subscribes this mapper to the nudge; it never goes negative.
  if (repaint.value < 0 || ...) return Skia.Path.Make()
})
```

### React Compiler and derived values

Any component calling `useDerivedValue` needs `'use no memo'`. The compiler memoises hook results
by its own rules, which do not know a derived value must be rebuilt when its declared dependencies
change.

### Worklets capture callees where they are written

A worklet captures the functions it calls at the point it is _written_, so a helper declared
further down the file is undefined at run time. Define helpers above their callers. Functions
nested inside a worklet must **not** carry their own `'worklet'` directive.

### A worklet freezes the object it reads a shared value off

`useDerivedValue(() => row.offset.value)` captures `row` itself, not just the shared value, and
Reanimated deep-freezes what a worklet captures. Any mutable bookkeeping kept on that object —
`row.y`, a flag, a timer handle — becomes silently unwritable: the assignment neither applies nor
throws, and the code reads its own stale state forever after.

Pass the shared values as individual props (`slotY={row.slotY} offset={row.offset}`) and keep the
mutable record on the JS side only. `ChartStack` and `useStackTransition` are the worked example; a
whole transition once animated to nowhere because of this.

## Data across the runtimes

### Skia objects cross by reference; arrays cross by copy

`SkPath`, `SkImage` and friends are JSI host objects — passing one to the UI runtime costs
nothing. A plain array is copied. So a chart keeps its samples on the JS side, bakes them into
paths once, and reads values back out of the path when it needs them:

```ts
// Binary search over path points, on the UI thread, with no sample data in sight
const point = tile.getPoint(mid)
```

Series data crossing a bridge should be parallel `number[]` arrays (`ts`, `vs`), never arrays of
objects: `Date` cannot be copied into a worklet at all, and per-point objects make every copy
proportional to allocation count.

### Do not shape text per frame

With a monospaced font, one glyph measured on the JS thread stands in for every label:
`width = text.length * glyphWidth`. Calling `font.getTextWidth` inside a mapper shapes text on
every touch move.

### A gesture must not reach React — including outside the canvas

The expensive part of a scrub is rarely the canvas; it is whatever else the finger drives. A
`setState` per touch sample re-runs the memos that build the chart spec and reconciles the whole
tree, and a native consumer can be worse still: an rnmapbox `PointAnnotation` with child views
re-snapshots those views to a bitmap on every coordinate change, which stalls the app outright.

So the scrub head is a shared value — a module singleton when consumers live in different trees —
and consumers read it on the UI thread:

- Inside the canvas: a `useDerivedValue`. Values printed beside a label are resolved from the
  series in a worklet, so formatting has to be carried as data (decimals, unit) rather than as a
  formatter — a JS closure cannot be called from a worklet.
- Outside the canvas: `useAnimatedReaction` → `runOnJS` → one imperative native call. A Mapbox
  `ShapeSource` takes a new position through `setNativeProps` with no render at all; feed it a
  `CircleLayer`, not an annotation.

Throttle only what genuinely renders — a preview that lands in a store. A consumer reached
imperatively needs no throttle.

## Where to look

- `src/components/charts/line/ScrubLayer.tsx` — one mapper for a whole stack, banner layout
- `src/components/charts/line/SelectionLayer.tsx` — transform-only animation, clip nesting
- `src/components/charts/line/SeriesLayer.tsx` — matrix projection, the repaint nudge
- `src/components/charts/line/seriesPaths.ts` — LOD tiles, sampling values back out of paths
- `src/components/charts/line/colorRamp.ts` — value colour as a camera-invariant gradient
- `src/components/charts/line/timeline.ts` — chart time vs real time, converted at the stack's edge
- `src/screens/main/map/SeekPositionPin.tsx` — a native consumer driven from a shared value
