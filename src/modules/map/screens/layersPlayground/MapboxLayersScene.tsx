import Mapbox from '@rnmapbox/maps'
import { useSharedValue } from 'react-native-reanimated'

import { theme } from '@/constants/theme'
import { GpsPuck, type MapPose } from '@/modules/map/components/GpsPuck'

import { countries, routeShape, useRiders, useSceneStyle } from './sceneData'
import { SceneRider } from './SceneRider'

/**
 * Spike #658: the benchmark layer load on Mapbox, mirroring `BENCH_LAYERS` of the MapLibre scene
 * (route with speed gradient, puck + 10 rider markers at frame rate, 16 symbols, country fills,
 * building extrusions). No toggles: the benchmark switches the whole scene on or off.
 */
export function MapboxBenchScene({ gpsFix }: { gpsFix: [number, number] }) {
  const { accents, routeGradient, riderColors, countryFill, symbols } = useSceneStyle()
  const riders = useRiders(true, 'frame')
  const puckBearing = useSharedValue<number | null>(45)
  const mapPose = useSharedValue<MapPose>({ heading: 0, pitch: 0 })

  return (
    <>
      <Mapbox.ShapeSource id="bench-countries" shape={countries}>
        <Mapbox.FillLayer
          id="bench-countries-fill"
          style={{ fillColor: countryFill as never, fillOpacity: 0.48 }}
        />
        <Mapbox.LineLayer
          id="bench-countries-outline"
          style={{
            lineColor: theme.palette.mono.white,
            lineWidth: ['interpolate', ['linear'], ['zoom'], 3, 0.75, 6, 1.6],
          }}
        />
      </Mapbox.ShapeSource>
      <Mapbox.FillExtrusionLayer
        id="bench-extrusion"
        sourceID="composite"
        sourceLayerID="building"
        minZoomLevel={14}
        maxZoomLevel={24}
        style={{
          fillExtrusionColor: accents.violet.color,
          fillExtrusionHeight: ['get', 'height'],
          fillExtrusionBase: ['get', 'min_height'],
          fillExtrusionOpacity: 0.85,
        }}
      />
      <Mapbox.ShapeSource id="bench-route" shape={routeShape} lineMetrics>
        <Mapbox.LineLayer
          id="bench-route-casing"
          style={{
            lineCap: 'round',
            lineJoin: 'round',
            lineColor: theme.palette.mono.black,
            lineOpacity: 0.6,
            lineWidth: 9,
          }}
        />
        <Mapbox.LineLayer
          id="bench-route-line"
          style={{
            lineCap: 'round',
            lineJoin: 'round',
            lineWidth: 5,
            lineGradient: routeGradient as never,
          }}
        />
      </Mapbox.ShapeSource>
      <Mapbox.Images
        images={{
          sygnet: require('../../../../../assets/images/favicon.png'),
          splash: require('../../../../../assets/images/splashIcon.png'),
        }}
      />
      <Mapbox.ShapeSource id="bench-symbols" shape={symbols}>
        <Mapbox.SymbolLayer
          id="bench-symbols-layer"
          style={{
            iconImage: ['get', 'icon'],
            iconSize: ['match', ['get', 'icon'], 'splash', 0.06, 0.6],
            textField: ['get', 'label'],
            textSize: 12,
            textOffset: [0, 1.4],
            iconAllowOverlap: true,
            textAllowOverlap: true,
            textColor: theme.palette.mono.white,
            textHaloColor: theme.palette.mono.black,
            textHaloWidth: 1.5,
          }}
        />
      </Mapbox.ShapeSource>
      <Mapbox.MarkerView coordinate={gpsFix} allowOverlap>
        <GpsPuck color={accents.purple.color} bearing={puckBearing} mapPose={mapPose} />
      </Mapbox.MarkerView>
      {riders.map((coordinate, index) => (
        <Mapbox.MarkerView key={index} coordinate={coordinate} allowOverlap>
          <SceneRider index={index} color={riderColors[index % riderColors.length]!} />
        </Mapbox.MarkerView>
      ))}
    </>
  )
}
