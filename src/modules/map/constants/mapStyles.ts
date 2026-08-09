import Mapbox from '@rnmapbox/maps'
import { MoonStarsIcon, MountainsIcon, PlanetIcon, SunIcon } from 'phosphor-react-native'
import { theme } from '@/constants/theme'

export const MAP_DEFAULTS = {
  fallbackCoordinate: [15.0, 54.0] as [number, number],
  fallbackZoom: 3.2,
  persistedGpsFallbackZoom: 11,
  maxZoom: 19,
  defaultPitch: 30,
  activePitch: 45,
  perspectiveMinZoom: 11,
  perspectiveMaxZoom: 16,
  zoomDeltaMultiplier: 4,
  zoomDeltaFallback: 0.004,
  zoomDeltaMinAccuracy: 0.002,
  animationDuration: 350,
  followAnimationDuration: 450,
  pitchThreshold: 10,
  markerColor: theme.palette.violet.color,
  markerInactiveColor: theme.palette.slate.light,
  trailColor: theme.palette.violet.color,
  trailWidth: 3,
  navigationWidth: 5,
  accuracyFillColor: theme.alpha(theme.palette.violet.color, 0.12),
  trailGradientStart: theme.alpha(theme.palette.violet.color, 0),
  trailGradientEnd: theme.alpha(theme.palette.violet.color, 0.85),
} as const

export const BLANK_STYLE = JSON.stringify({
  version: 8,
  sources: {},
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': theme.palette.slate.bg } },
  ],
})

export const MAP_STYLES = [
  { key: 'onedark', label: 'One Dark', styleURL: null, Icon: MoonStarsIcon },
  { key: 'outdoors', label: 'Outdoors', styleURL: Mapbox.StyleURL.Outdoors, Icon: SunIcon },
  {
    key: 'satellite',
    label: 'Satellite',
    styleURL: Mapbox.StyleURL.SatelliteStreet,
    Icon: PlanetIcon,
  },
  { key: 'mapy', label: 'Mapy.cz', styleURL: null, Icon: MountainsIcon },
] as const

export type MapStyleKey = (typeof MAP_STYLES)[number]['key']
export const MAP_NAVIGATION_MODES = [
  { key: 'northUp', label: 'North up' },
  { key: 'gpsHeading', label: 'GPS heading' },
  { key: 'phoneHeading', label: 'Compass' },
  { key: 'freeRotate', label: 'Free rotate' },
] as const

export type MapNavigationMode = (typeof MAP_NAVIGATION_MODES)[number]['key']
