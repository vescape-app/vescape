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
cameraRef.current?.setMarkersDirect([tag, lng, lat, version, burstMs /* , ...per marker */])
```

Both platforms draw them with `RNMBXMarkerSprites`, in the same custom layer as the rider puck
(`RNMBXPuck`, fed by `setPuckDirect`), after the coin, in the order sent:

- Android: GLES 3; snapshots through `View.draw`, which leaves the ghost's own alpha out.
- iOS: Metal; snapshots through `CALayer.render(in:)` with the ghost's opacity lifted for the call.

A `MarkerView` is positioned on the UI thread and trails the map by about a frame while the camera
moves. `src/components/map/InMapMarker.tsx` keeps the marker view mounted but transparent, as the
look's source and the touch target, and sends its React tag here. Native snapshots that view into
a bitmap when its `version` changes, and every frame for `burstMs` after, then draws it as a
screen-aligned sprite at the coordinate inside the map's own frame. `src/components/map/inMapLayer.ts`
batches every marker into one call per JS tick and holds the `view` / `layer` / `both` switch that
the puck uses too.

## Files changed inside `@rnmapbox/maps`

The patch updates all layers required by the package:

- public `CameraRef` API and implementation
- compiled JavaScript and TypeScript declarations shipped by the package
- TurboModule specification
- Android `RNMBXCamera`, `RNMBXCameraModule`, `RNMBXPuck` and `RNMBXMarkerSprites`
- iOS `RNMBXCamera`, `RNMBXCameraModule`, `RNMBXPuck` and `RNMBXMarkerSprites`

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
