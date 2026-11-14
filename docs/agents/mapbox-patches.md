# Mapbox patches

This project carries a Bun patch for `@rnmapbox/maps@10.3.2`:

- `patches/@rnmapbox%2Fmaps@10.3.2.patch`
- registered in `package.json#patchedDependencies`
- applied automatically by `bun install`

## Direct camera property updates

The patch adds this imperative camera method for high-frequency camera properties:

```ts
cameraRef.current?.setCameraDirect({ pitch })
cameraRef.current?.setCameraDirect({ heading })
```

It is used by `src/screens/main/MainMap.tsx` to continuously derive pitch from zoom while the
map camera is moving, including native deceleration after the user releases a pinch gesture. The
pitch calculation remains pure in `src/modules/map/lib/cameraProfiles.ts` (`getPitchForZoom`).

It also carries the fused phone heading in Compass mode (`usePhoneHeading` retargets the camera
engine, which writes through `setCameraDirect`) without starting and repeatedly cancelling Mapbox
camera transitions for every sensor sample.

### Why normal `setCamera` is not used

`Camera.setCamera({ pitch, animationDuration: 0 })` does not perform a neutral property write in
`@rnmapbox/maps`. On Android it reaches `CameraUpdateItem`, which calls Mapbox `flyTo` with a
zero-duration animation. Repeating that call from `onCameraChanged` starts camera transitions and
cancels the native pinch-zoom/deceleration transaction. The visible symptom is zoom momentum
stopping when automatic tilt changes.

`setCameraDirect` bypasses that transition queue:

- Android: `MapboxMap.setCamera(CameraOptions.Builder().pitch(pitch).build())`
- iOS: `mapboxMap.setCamera(to: CameraOptions(pitch: pitch))`

Use `setCameraDirect` only for camera properties that must track an already-running native camera
gesture or animation. Continue using normal `setCamera` for intentional app-driven camera moves,
such as focus, mode changes, recentering, and animated perspective toggles.

## Cancelling native camera motion

```ts
cameraRef.current?.cancelCameraAnimations()
```

- iOS: `mapView.camera.cancelAnimations()`
- Android: `mapView.camera.cancelAllAnimators()`

The counterpart to the property above. `setCameraDirect` writes camera state without touching
native animators, which is exactly what pitch-follows-zoom needs and exactly what an app-driven
camera move cannot live with: a fling started before the move keeps writing the camera every frame
and overwrites each frame the spring engine writes. The visible symptom is a recenter that lands
and then drifts on in the direction of the throw, ignoring repeated taps.

`src/screens/main/map/useCameraControls.ts` wires it to the camera engine's `cancelNativeMotion`,
which fires once when an app-issued target claims the camera — never per frame, and not for
retargets inside a move the engine already owns.

The current native bridge intentionally accepts only `pitch` and `heading`. Do not broaden it to
arbitrary camera options without a concrete use case and gesture-behavior verification.

## Drawing marker views inside the map frame

```ts
cameraRef.current?.setMarkersDirect([tag, lng, lat, version, burstMs, hide /* , ...per marker */])
```

Both platforms draw them with `RNMBXMarkerSprites`, in the same custom layer as the rider puck
(`RNMBXPuck`, fed by `setPuckDirect`), after the coin, in the order sent:

- Android: GLES 3; snapshots through `View.draw`. A photo decoded to a hardware bitmap cannot go on
  a software canvas, so that snapshot is recorded into a `Picture`, rendered by the GPU and read
  back into a mutable bitmap.
- iOS: Metal; snapshots through `CALayer.render(in:)`. Each sprite keeps up to four textures and
  only overwrites one whose last command buffer has completed; with all four in flight the upload
  waits a frame.

A `MarkerView` is positioned on the UI thread and trails the map by about a frame while the camera
moves. `src/components/map/InMapMarker.tsx` keeps the marker view mounted, as the look's source and
the touch target, and sends its React tag here. Native snapshots that view into a bitmap when its
`version` changes, and every frame for `burstMs` after, then draws it as a screen-aligned sprite at
the coordinate inside the map's own frame. If the view has not mounted yet, each burst frame looks
it up again.

With `hide` 1 native hides the marker view on screen once the first snapshot is in, in a way that
keeps hit testing intact:

- Android: the view's own alpha 0. Touch dispatch ignores alpha, and `View.draw` leaves out the
  view's own alpha, so the snapshot still sees it.
- iOS: an empty `CALayer` mask on the marker's `RNMBXMarkerViewParentViewAnnotation`. Fabric's hit
  test drops any view under 1% alpha, and Fabric resets the masks of its own views, so neither the
  ghost's alpha nor its mask is usable; the annotation host is not a Fabric view.

JS bumps `version` only when the look changes: a new view, content that renders differently
(`src/components/map/sameLook.ts`), a touch (pressed feedback) or an explicit
`useInMapMarkerRefresh()` such as an image finishing its decode. Moving a marker only moves its
sprite. `src/components/map/markerLayerChannel.ts` batches every marker into one call per JS tick;
`src/components/map/inMapLayer.ts` holds the `view` / `layer` / `both` switch that the puck uses
too.

The layer sits on top of the style. A layer the app adds later without `aboveLayerID`,
`belowLayerID` or `layerIndex` (a route, a trail) is inserted below it by `RNMBXLayer`, so it never
covers the puck or a marker. A positioned layer that still lands above is caught the next time the
puck moves or a marker changes, when `RNMBXPuck` moves its layer back to the top.

## Files changed inside `@rnmapbox/maps`

The patch updates all layers required by the package:

- public `CameraRef` API and implementation
- compiled JavaScript and TypeScript declarations shipped by the package
- TurboModule specification
- Android `RNMBXCamera`, `RNMBXCameraModule`, `RNMBXPuck`, `RNMBXMarkerSprites` and `RNMBXLayer`
- iOS `RNMBXCamera`, `RNMBXCameraModule`, `RNMBXPuck`, `RNMBXMarkerSprites` and `RNMBXLayer`

## Camera-changed payload without bounds

`onCameraChanged` fires synchronously from inside every camera write, including each frame the
camera engine writes. Upstream builds its payload with a viewport unprojection:

```swift
let bounds = mapView.mapboxMap.coordinateBounds(for: cameraOptions)
```

No consumer in this app reads `bounds` off that event — both handlers
(`src/screens/main/map/useMainMapCameraEvents.ts`, `src/screens/privacyZones/usePrivacyZoneEditor.ts`)
take `center`, `zoom`, `heading`, `pitch`, and `gestures.isGestureActive`. The patch takes an
`includeBounds` flag on the payload builder and passes `false` for `cameraChanged`, `true` for
`mapIdle`, so a settled map still reports its bounds once per rest.

`MapState['properties']['bounds']` is optional in the patched types to match. Both platforms are
patched identically — the payload shape crosses the bridge, so it cannot diverge by platform.

Do not edit `node_modules` directly and leave it uncommitted. Update the durable Bun patch instead.

## Updating `@rnmapbox/maps`

When changing the dependency version:

1. Check whether upstream now provides a non-transitioning camera-property API.
2. If it does, migrate `MainMap` to that API and remove this patch.
3. Otherwise recreate the patch against the new version with `bun patch @rnmapbox/maps`.
4. Reapply the direct setter to source, compiled output, declarations, TurboModule spec, Android, and
   iOS.
5. Reapply the `includeBounds` payload flag to `RNMBXMapView` on both platforms and the optional
   `bounds` in `MapState`.
6. Commit it with `bun patch --commit 'node_modules/@rnmapbox/maps'`.
7. Verify a clean `bun install` applies it.
8. Rebuild the native app. Metro refresh is insufficient for native patch changes.

Minimum verification:

```sh
bun run ts
bun test src/modules/map/lib/cameraProfiles.test.ts
cd android && ./gradlew :app:compileDebugKotlin
```

On a device, pinch and release quickly in map mode. Zoom must keep decelerating while pitch follows
the changing zoom. Also verify normal recentering and navigation-mode camera animations.
