import Mapbox, { Camera, MapView } from '@rnmapbox/maps'
import { SlidersHorizontalIcon } from 'phosphor-react-native'
import { useCallback, useMemo, useRef, useState, type ElementRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'
import { Text } from '@/components/base/Text'
import type { MapPoint } from 'vescape-core'

import { IconButton } from '@/components/base/IconButton'
import { EdgeDrawer } from '@/components/overlays/AnchoredSheet'
import { useTriggerRef } from '@/components/overlays/measureTrigger'
import { ChipRow, ToggleRow, ValueRow } from '@/components/dev/ShowcaseControls'
import { MapStyleSwitch } from '@/modules/map/components/MapStyleSwitch'
import { MapNavigationSelector } from '@/modules/map/components/MapNavigationSelector'
import { MAPBOX_ACCESS_TOKEN } from '@/config/mapy'
import {
  BLANK_STYLE,
  MAP_STYLES,
  type MapNavigationMode,
  type MapStyleKey,
} from '@/modules/map/constants/mapStyles'
import { getSatelliteDarkMapStyle } from '@/modules/map/constants/satelliteDarkMapStyle'
import { ONE_DARK_MAP_STYLE } from '@/modules/map/constants/oneDarkMapStyle'
import { neutralColors, theme } from '@/constants/theme'
import { useThemeStore } from '@/hooks/useTheme'
import { resolveMapThemeTone } from '@/modules/map/lib/mapThemeTone'
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

Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN)

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
  const [styleExpanded, setStyleExpanded] = useState(false)
  const [navigationMode, setNavigationMode] = useState<MapNavigationMode>('northUp')
  const [navigationExpanded, setNavigationExpanded] = useState(false)
  const navigationHeading = useSharedValue(32)
  const [weatherActive, setWeatherActive] = useState(false)
  const [legalLimitsActive, setLegalLimitsActive] = useState(false)
  const [mapPoints] = useState<MapPoint[]>(FIXTURE_MAP_POINTS)
  const [selectedMapPointId, setSelectedMapPointId] = useState<string | null>(null)
  const [activeHistoryMapMetric, setActiveHistoryMapMetric] = useState<HistoryMetricKey>('speed')
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const [sheetVisible, setSheetVisible] = useState(false)
  const cameraRef = useRef<ElementRef<typeof Camera>>(null)
  const moreTriggerRef = useTriggerRef()
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const outdoorLight = useThemeStore((state) => state.outdoorLight)

  const handleMapLoaded = useCallback(() => {
    cameraRef.current?.setCamera({
      centerCoordinate: FIXTURE_CAMERA_CENTER,
      zoomLevel: FIXTURE_CAMERA_ZOOM,
      animationDuration: 0,
    })
  }, [])

  const selectedStyle = MAP_STYLES.find((s) => s.key === styleKey) ?? MAP_STYLES[0]
  const isMapy = selectedStyle.key === 'mapy'
  const isOneDark = selectedStyle.key === 'onedark'
  const isSatellite = selectedStyle.key === 'satellite'
  const useCustomJSON = isMapy || isOneDark || isSatellite
  const showBuildings3d = selectedStyle.key === 'outdoors' || selectedStyle.key === 'onedark'
  const satelliteTone = useMemo(
    () =>
      resolveMapThemeTone({
        theme: resolvedTheme,
        outdoorLight,
        imageryOpacity: 1,
        imagerySaturation: 0,
      }),
    [outdoorLight, resolvedTheme],
  )
  const satelliteStyleJSON = useMemo(
    () =>
      getSatelliteDarkMapStyle(
        satelliteTone.imageryOpacity,
        true,
        true,
        false,
        true,
        satelliteTone.imagerySaturation,
        satelliteTone.roadLineOpacity,
        satelliteTone.imageryContrast,
        neutralColors[resolvedTheme].surfaceDeep,
      ),
    [resolvedTheme, satelliteTone],
  )

  return (
    <View style={styles.container}>
      <MapView
        style={StyleSheet.absoluteFill}
        styleURL={useCustomJSON ? undefined : selectedStyle.styleURL}
        styleJSON={
          isOneDark
            ? ONE_DARK_MAP_STYLE
            : isMapy
              ? BLANK_STYLE
              : isSatellite
                ? satelliteStyleJSON
                : undefined
        }
        pitchEnabled={false}
        rotateEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
        logoEnabled={false}
        attributionEnabled={false}
        onDidFinishLoadingMap={handleMapLoaded}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: FIXTURE_CAMERA_CENTER,
            zoomLevel: FIXTURE_CAMERA_ZOOM,
          }}
          animationMode="none"
        />
        {/* historyActive=false renders buildings/raster/weather + live pins/GPS puck/riders */}
        <MainMapLayers
          historyActive={false}
          expandSelectedMapPoints
          isMapy={isMapy}
          isOneDark={isOneDark}
          isSatellite={isSatellite}
          showBuildings3d={showBuildings3d}
          weatherActive={weatherActive}
          legalLimitsActive={legalLimitsActive}
          liveTrailShape={FIXTURE_LIVE_TRAIL_SHAPE}
          rideRouteShape={null}
          accuracyFix={FIXTURE_ACCURACY_FIX}
          accuracyShape={FIXTURE_ACCURACY_SHAPE}
          gpsPuckBearingDeg={FIXTURE_GPS_PUCK_BEARING_DEG}
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
      </MapView>

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
        <MapNavigationSelector
          activeMode={navigationMode}
          heading={navigationHeading}
          expanded={navigationExpanded}
          onToggle={() => setNavigationExpanded((value) => !value)}
          onSelect={(mode) => {
            setNavigationMode(mode)
            setNavigationExpanded(false)
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
        <ValueRow label="Last interaction" value={lastEvent ?? '—'} />
        <Text style={styles.hint}>
          Tap a pin to expand its label + delete button. Buildings 3D follows the style (Outdoors,
          One Dark).
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
