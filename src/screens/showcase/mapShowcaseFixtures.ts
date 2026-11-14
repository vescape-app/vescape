import type { HistoryGpsSample, HistoryMarker, MapPoint, TelemetrySample } from 'vescape-core'

import { makeCircleFeature, makeTrailLineString } from '@/helpers/mapGeometry'
import type { DirectionPoint } from '@/modules/map/store/mapStore'
import type { MediaHistoryAsset } from '@/modules/history/lib/mediaHistory'
import { DEFAULT_HISTORY_METRIC_HOT_RANGES } from '@/modules/history/lib/metricColorScale'
import type { RosterRider } from '@/modules/group-ride/lib/roster'
import { monotonicNow, type RelayClock } from '@/modules/group-ride/lib/riderSignal'

const NOW = Date.now()
const BASE_LON = 14.4378
const BASE_LAT = 50.0755
const PLACEHOLDER_MEDIA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const MAP_POINT_CATEGORIES: MapPoint['category'][] = [
  'drop',
  'bonk',
  'nose_slide',
  'trail_entry',
  'viewpoint',
  'charging',
]

export const FIXTURE_CAMERA_CENTER: [number, number] = [BASE_LON, BASE_LAT]
export const FIXTURE_CAMERA_ZOOM = 13.7

export const FIXTURE_MAP_POINTS: MapPoint[] = MAP_POINT_CATEGORIES.map((category, index) => {
  const angle = (index / MAP_POINT_CATEGORIES.length) * Math.PI * 2
  return {
    id: `fixture-point-${category}`,
    category,
    longitude: BASE_LON + Math.cos(angle) * 0.008,
    latitude: BASE_LAT + Math.sin(angle) * 0.008,
    name: null,
    description: null,
    score: index - 2,
    myReaction: null,
    ownedByMe: index === 0,
    distanceMeters: 120 * (index + 1),
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
  }
})

export const FIXTURE_DIRECTION_POINT: DirectionPoint = {
  longitude: BASE_LON + 0.0045,
  latitude: BASE_LAT + 0.0035,
}

const ROUTE_POINT_COUNT = 14
const rideRouteCoordinates: [number, number][] = Array.from(
  { length: ROUTE_POINT_COUNT },
  (_, i) => {
    const t = i / (ROUTE_POINT_COUNT - 1)
    return [
      BASE_LON - 0.008 + t * 0.016 + Math.sin(t * Math.PI * 3) * 0.0012,
      BASE_LAT - 0.006 + t * 0.006,
    ]
  },
)

export const FIXTURE_RIDE_ROUTE = rideRouteCoordinates
export const FIXTURE_RIDE_ROUTE_SHAPE = {
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: rideRouteCoordinates },
  properties: {},
} as const

export const FIXTURE_RIDE_GPS_SAMPLES: HistoryGpsSample[] = rideRouteCoordinates.map(
  ([longitude, latitude], index) => {
    const t = index / (ROUTE_POINT_COUNT - 1)
    return {
      id: index + 1,
      capturedAtMs: NOW - (ROUTE_POINT_COUNT - 1 - index) * 5_000,
      boardId: 'fixture-board',
      boardName: 'Fixture Board',
      latitude,
      longitude,
      speedMps: 3 + Math.sin(t * Math.PI * 2) * 2.5,
      bearingDeg: (t * 360) % 360,
      accuracyM: 5,
      altitudeM: 240 + index,
      timestamp: NOW - (ROUTE_POINT_COUNT - 1 - index) * 5_000,
      distanceFromPreviousM: index === 0 ? null : 80,
    }
  },
)

export const FIXTURE_FAVORITE_RANGES = [
  {
    startMs: FIXTURE_RIDE_GPS_SAMPLES[3].capturedAtMs,
    endMs: FIXTURE_RIDE_GPS_SAMPLES[8].capturedAtMs,
  },
]

export const FIXTURE_RIDE_TELEMETRY_SAMPLES: TelemetrySample[] = FIXTURE_RIDE_GPS_SAMPLES.map(
  (gps, index) => {
    const t = index / (ROUTE_POINT_COUNT - 1)
    const speedKmh = 12 + (Math.sin(t * Math.PI * 2) * 0.5 + 0.5) * 34
    return {
      id: index + 1,
      capturedAtMs: gps.capturedAtMs,
      boardId: 'fixture-board',
      boardName: 'Fixture Board',
      speedKmh,
      batteryVoltage: 58 - t * 4,
      batteryPercent: 80 - t * 30,
      motorCurrent: 8 + speedKmh * 0.6,
      batteryCurrent: 4 + speedKmh * 0.3,
      dutyCycle: Math.min(0.95, speedKmh / 48),
      pitch: 0,
      roll: 0,
      balancePitch: 0,
      balanceCurrent: 0,
      erpm: speedKmh * 95,
      state: 0,
      switchState: 2,
      adc1: 0,
      adc2: 0,
      odometer: null,
      tempMosfet: 35 + t * 30,
      tempMotor: 40 + t * 35,
      latitude: gps.latitude,
      longitude: gps.longitude,
    }
  },
)

const MARKER_TYPES: HistoryMarker['type'][] = [
  'connected',
  'disconnected',
  'connection_lost',
  'error',
  'gap',
  'app_stop',
  'recording_stop',
  'auto_pause',
]

export const FIXTURE_RIDE_MARKERS: HistoryMarker[] = MARKER_TYPES.map((type, index) => ({
  id: index + 1,
  occurredAtMs:
    FIXTURE_RIDE_GPS_SAMPLES[(2 + index * 2) % FIXTURE_RIDE_GPS_SAMPLES.length].capturedAtMs,
  type,
  boardId: 'fixture-board',
  message: type === 'error' ? 'Fixture fault for preview' : null,
  gapMs: type === 'gap' ? 15_000 : null,
}))

export const FIXTURE_MEDIA_ASSETS: MediaHistoryAsset[] = [
  {
    id: 'fixture-media-photo',
    uri: PLACEHOLDER_MEDIA_URI,
    filename: 'fixture-photo.png',
    mediaType: 'photo',
    creationTime: FIXTURE_RIDE_GPS_SAMPLES[4].capturedAtMs,
    gps: FIXTURE_RIDE_GPS_SAMPLES[4],
  },
  {
    id: 'fixture-media-video',
    uri: PLACEHOLDER_MEDIA_URI,
    filename: 'fixture-video.png',
    mediaType: 'video',
    creationTime: FIXTURE_RIDE_GPS_SAMPLES[9].capturedAtMs,
    gps: FIXTURE_RIDE_GPS_SAMPLES[9],
  },
]

const liveTrailCoordinates: { longitude: number; latitude: number }[] = Array.from(
  { length: 6 },
  (_, i) => ({
    longitude: BASE_LON - 0.0015 + i * 0.0006,
    latitude: BASE_LAT + 0.005 + i * 0.0004,
  }),
)

export const FIXTURE_LIVE_TRAIL_SHAPE = makeTrailLineString(liveTrailCoordinates)
export const FIXTURE_ACCURACY_FIX = liveTrailCoordinates.at(-1)!
export const FIXTURE_ACCURACY_SHAPE = makeCircleFeature(
  FIXTURE_ACCURACY_FIX.longitude,
  FIXTURE_ACCURACY_FIX.latitude,
  18,
)
export const FIXTURE_GPS_PUCK_BEARING_DEG = 48

/** A short path of `count` points trailing behind `(lat, lng)`, for showcasing rider trails. */
function fixtureTrail(
  lat: number,
  lng: number,
  dLat: number,
  dLng: number,
  count = 8,
): { lat: number; lng: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const back = count - 1 - i
    return { lat: lat - dLat * back, lng: lng - dLng * back }
  })
}

/** Where the showcase roster measures rider distances from: the camera centre. */
export const FIXTURE_OWN_LOCATION = { lat: BASE_LAT, lng: BASE_LON }

/** Other Riders: live, live with hot telemetry, stale, and away for minutes. */
export const FIXTURE_RIDERS: RosterRider[] = [
  {
    id: 'fixture-rider-ana',
    name: 'Ana',
    presence: {
      lat: BASE_LAT + 0.005,
      lng: BASE_LON + 0.0005,
      heading: 120,
      speed: 6.2,
      soc: 0.71,
      motorTemp: 48,
      ctrlTemp: 39,
      phoneBattery: 0.82,
      boardName: 'Ana Board',
      target: { lat: BASE_LAT + 0.0075, lng: BASE_LON + 0.003 },
    },
    trail: fixtureTrail(BASE_LAT + 0.005, BASE_LON + 0.0005, 0.0003, 0.0002),
    stale: false,
    away: false,
    lastSeen: NOW,
    isSelf: false,
  },
  {
    id: 'fixture-rider-jonas',
    name: 'Jonáš',
    presence: {
      lat: BASE_LAT + 0.0042,
      lng: BASE_LON - 0.0012,
      heading: 260,
      speed: 4.8,
      soc: 0.12,
      motorTemp: 83,
      ctrlTemp: 64,
      phoneBattery: 0.35,
      boardName: 'Jonáš Board with a very long name',
    },
    trail: fixtureTrail(BASE_LAT + 0.0042, BASE_LON - 0.0012, -0.00005, 0.00035),
    stale: false,
    away: false,
    lastSeen: NOW,
    isSelf: false,
  },
  {
    id: 'fixture-rider-miguel',
    name: 'Miguel',
    presence: {
      lat: BASE_LAT + 0.0058,
      lng: BASE_LON + 0.0022,
      heading: null,
      speed: null,
      soc: null,
      boardName: null,
    },
    trail: fixtureTrail(BASE_LAT + 0.0058, BASE_LON + 0.0022, 0.0002, -0.0003),
    stale: true,
    away: false,
    lastSeen: NOW - 20_000,
    isSelf: false,
  },
  {
    id: 'fixture-rider-zoe',
    name: 'Zoë',
    presence: {
      lat: BASE_LAT - 0.003,
      lng: BASE_LON + 0.004,
      heading: 40,
      speed: 0,
      soc: 0.54,
      motorTemp: 36,
      ctrlTemp: 33,
      phoneBattery: 0.6,
      boardName: 'Zoë Board',
    },
    trail: null,
    stale: true,
    away: true,
    lastSeen: NOW - 7 * 60_000,
    isSelf: false,
  },
]

/** The Social roster as the device sees it: its own Rider first, then everyone else by name. */
export const FIXTURE_ROSTER_ROWS: RosterRider[] = [
  {
    id: 'fixture-rider-me',
    name: 'Kacper',
    presence: {
      lat: BASE_LAT,
      lng: BASE_LON,
      heading: 90,
      speed: 5.4,
      soc: 0.66,
      motorTemp: 52,
      ctrlTemp: 41,
      phoneBattery: 0.74,
      boardName: 'GT-S',
    },
    trail: null,
    stale: false,
    away: false,
    lastSeen: NOW,
    isSelf: true,
  },
  ...FIXTURE_RIDERS,
]

/** A relay clock at the fixture's `NOW`, so fixture pins count as active. */
export const FIXTURE_RELAY_CLOCK: RelayClock = { relayNow: NOW, receivedAt: monotonicNow() }

const fixturePin = (kind: string, lat: number, lng: number) => ({
  kind,
  lat,
  lng,
  startedAt: NOW,
  // Long enough that a showcase left open does not watch the pins expire.
  expiresAt: NOW + 24 * 60 * 60_000,
})

/**
 * Every signal and hazard kind on the map, spread around the riders: one rider's signal sits on its
 * presence, the rest where the sender used to be.
 */
export const FIXTURE_PIN_ROWS: RosterRider[] = [
  {
    ...FIXTURE_RIDERS[0],
    signal: fixturePin('serious', BASE_LAT + 0.005, BASE_LON + 0.0005),
    hazard: fixturePin('water', BASE_LAT + 0.0025, BASE_LON - 0.0035),
  },
  {
    ...FIXTURE_RIDERS[1],
    signal: fixturePin('minor', BASE_LAT + 0.0015, BASE_LON - 0.0045),
    hazard: fixturePin('terrain', BASE_LAT - 0.001, BASE_LON - 0.006),
  },
  {
    ...FIXTURE_RIDERS[2],
    signal: fixturePin('down', BASE_LAT + 0.0075, BASE_LON - 0.003),
    hazard: fixturePin('obstacle', BASE_LAT + 0.009, BASE_LON + 0.0015),
  },
  {
    ...FIXTURE_RIDERS[3],
    signal: fixturePin('battery', BASE_LAT - 0.0005, BASE_LON + 0.0055),
    hazard: fixturePin('police', BASE_LAT - 0.006, BASE_LON + 0.0005),
  },
  ...(['tire', 'overheat', 'board', 'wait', 'break'] as const).map((kind, i) => ({
    ...FIXTURE_ROSTER_ROWS[0],
    id: `fixture-rider-pin-${kind}`,
    signal: fixturePin(kind, BASE_LAT - 0.0075, BASE_LON - 0.0045 + i * 0.0025),
  })),
]

export const FIXTURE_HISTORY_METRIC_HOT_RANGES = DEFAULT_HISTORY_METRIC_HOT_RANGES
