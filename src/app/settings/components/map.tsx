import { Camera, Map as MapLibreMap } from '@maplibre/maplibre-react-native'
import { SlidersHorizontalIcon } from 'phosphor-react-native'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'
import { Text } from '@/components/base/Text'
import type { MapPoint, NavigationProfile } from 'vescape-core'

import { IconButton } from '@/components/base/IconButton'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { useTriggerRef } from '@/components/overlays/measureTrigger'
import { ChipRow, ToggleRow, ValueRow } from '@/components/dev/ShowcaseControls'
import { MapStyleSwitch } from '@/modules/map/components/MapStyleSwitch'
import { NavigationProfileSelector } from '@/modules/map/components/NavigationProfileSelector'
import type { MapStyleKey } from '@/modules/map/constants/mapStyles'
import {
  DEFAULT_SATELLITE_IMAGERY_OPACITY,
  DEFAULT_SATELLITE_IMAGERY_SATURATION,
  DEFAULT_SATELLITE_MAP_IMAGERY_OPACITY,
} from '@/modules/map/constants/satelliteDarkMapStyle'
import { theme } from '@/constants/theme'
import type { HistoryMetricKey } from '@/modules/history/lib/metricColorScale'
import {
  FIXTURE_ACCURACY_FIX,
  FIXTURE_ACCURACY_SHAPE,
  FIXTURE_CAMERA_CENTER,
  FIXTURE_CAMERA_ZOOM,
  FIXTURE_DIRECTION_POINT,
  FIXTURE_FAVORITE_RANGES,
  FIXTURE_GPS_PUCK_BEARING_DEG,
  FIXTURE_HISTORY_METRIC_HOT_RANGES,
  FIXTURE_LIVE_TRAIL_SHAPE,
  FIXTURE_MAP_POINTS,
  FIXTURE_MEDIA_ASSETS,
  FIXTURE_RIDE_GPS_SAMPLES,
  FIXTURE_RIDE_MARKERS,
  FIXTURE_RIDE_ROUTE,
  FIXTURE_RIDE_ROUTE_SHAPE,
  FIXTURE_RIDE_TELEMETRY_SAMPLES,
  FIXTURE_RIDERS,
} from '@/screens/showcase/mapShowcaseFixtures'
import { MainMapLayers, HistoryMapLayers } from '@/screens/main/map/MainMapLayers'
import { useResolvedMapStyle } from '@/screens/main/map/useResolvedMapStyle'
import { DASH } from '@/helpers/format'

const HISTORY_METRIC_OPTIONS: { key: HistoryMetricKey; label: string }[] = [
  { key: 'speed', label: 'Speed' },
  { key: 'duty', label: 'Duty' },
  { key: 'battery', label: 'Battery' },
  { key: 'tempMotor', label: 'Motor temp' },
  { key: 'tempController', label: 'Controller temp' },
  { key: 'motorCurrent', label: 'Motor current' },
  { key: 'batteryCurrent', label: 'Battery current' },
]

export default function MapComponentsShowcase() {
  const [styleKey, setStyleKey] = useState<MapStyleKey>('onedark')
  // Fixture camera is north-up and flat, so the arrow shows the raw fixture bearing.
  const mapPose = useSharedValue({ heading: 0, pitch: 0 })
  const puckBearing = useSharedValue<number | null>(FIXTURE_GPS_PUCK_BEARING_DEG)
  const [styleExpanded, setStyleExpanded] = useState(false)
  const [weatherActive, setWeatherActive] = useState(false)
  const [legalLimitsActive, setLegalLimitsActive] = useState(false)
  const [mapPoints] = useState<MapPoint[]>(FIXTURE_MAP_POINTS)
  const [selectedMapPointId, setSelectedMapPointId] = useState<string | null>(null)
  const [activeHistoryMapMetric, setActiveHistoryMapMetric] = useState<HistoryMetricKey>('speed')
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const [sheetVisible, setSheetVisible] = useState(false)
  const [navigationProfile, setNavigationProfile] = useState<NavigationProfile>('walking')
  const [loadedSignature, setLoadedSignature] = useState<string | null>(null)
  const moreTriggerRef = useTriggerRef()
  // The main map's own style resolution, in map mode with default satellite tone.
  const mapStyle = useResolvedMapStyle({
    mapStyleKey: styleKey,
    mode: 'map',
    satelliteOverlayEnabled: true,
    satelliteImageryOpacity: DEFAULT_SATELLITE_IMAGERY_OPACITY,
    satelliteMapImageryOpacity: DEFAULT_SATELLITE_MAP_IMAGERY_OPACITY,
    satelliteImagerySaturation: DEFAULT_SATELLITE_IMAGERY_SATURATION,
    hideTelemetryMapDetails: false,
  })
  const { isSatellite } = mapStyle
  const styleLoaded = loadedSignature === mapStyle.styleSignature

  return (
    <View style={styles.container}>
      <MapLibreMap
        // A fresh map per style: app layers mount once their base style has loaded.
        key={mapStyle.styleSignature}
        style={StyleSheet.absoluteFill}
        mapStyle={mapStyle.mapStyle}
        touchPitch={false}
        touchRotate={false}
        compass={false}
        scaleBar={false}
        logo={false}
        attribution={false}
        onDidFinishLoadingStyle={() => setLoadedSignature(mapStyle.styleSignature)}
      >
        <Camera initialViewState={{ center: FIXTURE_CAMERA_CENTER, zoom: FIXTURE_CAMERA_ZOOM }} />
        {styleLoaded && (
          <>
            {/* historyActive=false renders buildings/raster/weather + live pins/GPS puck/riders */}
            <MainMapLayers
              historyActive={false}
              expandSelectedMapPoints
              isSatellite={isSatellite}
              fillBeforeId={mapStyle.fillBeforeId}
              weatherActive={weatherActive}
              legalLimitsActive={legalLimitsActive}
              liveTrailShape={FIXTURE_LIVE_TRAIL_SHAPE}
              rideRouteShape={null}
              accuracyFix={FIXTURE_ACCURACY_FIX}
              accuracyShape={FIXTURE_ACCURACY_SHAPE}
              puckBearing={puckBearing}
              mapPose={mapPose}
              riders={FIXTURE_RIDERS}
              rideRoute={[]}
              rideTelemetrySamples={[]}
              activeHistoryMapMetric={activeHistoryMapMetric}
              rideMarkers={[]}
              rideGpsSamples={[]}
              mediaAssets={[]}
              favoriteRanges={[]}
              mapZoom={FIXTURE_CAMERA_ZOOM}
              historyMetricGradientsEnabled
              historyMetricHotRanges={FIXTURE_HISTORY_METRIC_HOT_RANGES}
              directionPoint={FIXTURE_DIRECTION_POINT}
              activeNavigationTarget={null}
              selectedNavigationTarget={null}
              mapPoints={mapPoints}
              selectedMapPointId={selectedMapPointId}
              hiddenMapPointCategories={[]}
              onToggleMapPointSelection={(id) =>
                setSelectedMapPointId((current) => (current === id ? null : id))
              }
              onSuppressNextMapPress={() => {}}
              onSelectMarker={() => {}}
              onOpenMedia={() => {}}
              onSelectLegalCountry={() => {}}
              onFocusDirectionPoint={() => {}}
            />
            {/* Rendered alongside the live layer (not behind historyActive) so the ride route,
            markers and media pins are always visible together with everything above. */}
            <HistoryMapLayers
              rideRouteShape={FIXTURE_RIDE_ROUTE_SHAPE}
              rideRoute={FIXTURE_RIDE_ROUTE}
              rideTelemetrySamples={FIXTURE_RIDE_TELEMETRY_SAMPLES}
              activeHistoryMapMetric={activeHistoryMapMetric}
              rideMarkers={FIXTURE_RIDE_MARKERS}
              rideGpsSamples={FIXTURE_RIDE_GPS_SAMPLES}
              mediaAssets={FIXTURE_MEDIA_ASSETS}
              favoriteRanges={FIXTURE_FAVORITE_RANGES}
              mapZoom={FIXTURE_CAMERA_ZOOM}
              historyMetricGradientsEnabled
              historyMetricHotRanges={FIXTURE_HISTORY_METRIC_HOT_RANGES}
              onSuppressNextMapPress={() => {}}
              onSelectMarker={(selection) => setLastEvent(`Marker: ${selection.marker.type}`)}
              onOpenMedia={(asset) => setLastEvent(`Media: ${asset.filename}`)}
              highContrastRoutes={isSatellite}
            />
          </>
        )}
      </MapLibreMap>

      <View style={styles.topRight} pointerEvents="box-none">
        <MapStyleSwitch
          activeKey={styleKey}
          expanded={styleExpanded}
          onToggle={() => setStyleExpanded((v) => !v)}
          onSelect={(key) => {
            setStyleKey(key)
            setStyleExpanded(false)
          }}
        />
        <NavigationProfileSelector
          activeProfile={navigationProfile}
          onSelect={(profile) => {
            setNavigationProfile(profile)
            setLastEvent(`Navigation Profile: ${profile}`)
          }}
        />
        {/* Open variant: what the navigation sheet shows while a path is on screen. */}
        <NavigationProfileSelector
          activeProfile={navigationProfile}
          open
          onSelect={(profile) => {
            setNavigationProfile(profile)
            setLastEvent(`Navigation Profile (open): ${profile}`)
          }}
        />
        <View ref={moreTriggerRef} collapsable={false}>
          <IconButton
            icon={SlidersHorizontalIcon}
            size="md"
            onPress={() => setSheetVisible(true)}
            style={styles.floatingButton}
          />
        </View>
      </View>

      <EdgeDrawer
        visible={sheetVisible}
        triggerRef={moreTriggerRef}
        title="Map options"
        onClose={() => setSheetVisible(false)}
      >
        <ToggleRow label="Weather radar" value={weatherActive} onToggle={setWeatherActive} />
        <ToggleRow label="Legal limits" value={legalLimitsActive} onToggle={setLegalLimitsActive} />
        <ChipRow
          label="Route metric"
          options={HISTORY_METRIC_OPTIONS.map((m) => m.label)}
          selected={
            HISTORY_METRIC_OPTIONS.find((m) => m.key === activeHistoryMapMetric)?.label ?? 'Speed'
          }
          onSelect={(label) => {
            const match = HISTORY_METRIC_OPTIONS.find((m) => m.label === label)
            if (match) setActiveHistoryMapMetric(match.key)
          }}
        />
        <ValueRow label="Last interaction" value={lastEvent ?? DASH} />
        <Text style={styles.hint}>
          Tap a pin to expand its label + delete button. 3D buildings follow the base style.
        </Text>
      </EdgeDrawer>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  topRight: {
    position: 'absolute',
    top: 12,
    right: 12,
    alignItems: 'flex-end',
    gap: 8,
  },
  floatingButton: {
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.85),
  },
  hint: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
})
