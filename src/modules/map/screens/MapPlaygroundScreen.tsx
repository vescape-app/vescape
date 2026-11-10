import { useResolvedAccentColors } from '@/hooks/useTheme'
import Mapbox, { type Camera as CameraRef } from '@rnmapbox/maps'
import { useCallback, useRef } from 'react'
import { View } from 'react-native'

import { makeCircleFeature } from '@/helpers/mapGeometry'
import type { EngineCamera } from '@/modules/map/lib/cameraEngine/engine'
import {
  PLAYGROUND_START,
  PLAYGROUND_START_ZOOM,
  playgroundStyles,
  useCameraPlayground,
} from '@/modules/map/screens/cameraPlayground'

/**
 * Dev-only bench for `cameraEngine` on Mapbox. Drivers, tuning and telemetry live in
 * `useCameraPlayground`, shared with the MapLibre playground.
 */
export function MapPlaygroundScreen() {
  const accents = useResolvedAccentColors()
  const cameraRef = useRef<CameraRef>(null)

  const applyCamera = useCallback((camera: EngineCamera) => {
    // TODO: switch to setCameraDirect once the extended patch lands
    cameraRef.current?.setCamera({
      centerCoordinate: camera.centerCoordinate,
      zoomLevel: camera.zoomLevel,
      heading: camera.heading,
      pitch: camera.pitch,
      animationDuration: 0,
    })
  }, [])
  const { gpsFix, panel } = useCameraPlayground({ name: 'mapbox', applyCamera })

  return (
    <View style={playgroundStyles.screen}>
      <View style={playgroundStyles.mapPane}>
        <Mapbox.MapView
          style={playgroundStyles.map}
          styleURL={Mapbox.StyleURL.Dark}
          scaleBarEnabled={false}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
        >
          <Mapbox.Camera
            ref={cameraRef}
            defaultSettings={{
              centerCoordinate: PLAYGROUND_START,
              zoomLevel: PLAYGROUND_START_ZOOM,
              heading: 0,
              pitch: 0,
            }}
            animationMode="none"
          />
          <Mapbox.ShapeSource
            id="playground-fix"
            shape={makeCircleFeature(gpsFix[0], gpsFix[1], 8)}
          >
            <Mapbox.FillLayer
              id="playground-fix-fill"
              style={{
                fillColor: accents.violet.color,
                fillOutlineColor: accents.violet.light,
              }}
            />
          </Mapbox.ShapeSource>
        </Mapbox.MapView>
      </View>
      {panel}
    </View>
  )
}
