/**
 * Spike #661: same routes from Mapbox Directions (as the server proxy calls it), Valhalla on the
 * FOSSGIS public server and BRouter, with distance, duration and surface share. Surface for Mapbox
 * and Valhalla lines comes from Valhalla `trace_attributes` (map-matching the line onto OSM); BRouter
 * reports surface itself. One GeoJSON per route goes to the output dir.
 *
 *   bun run scripts/spike/compare-routing.ts [--out /tmp/spike/routes] [--only <route id prefix>]
 *
 * GraphHopper hosted is skipped: no GRAPHHOPPER_API_KEY. Public servers get one request at a time.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { readEnv, redact, sleep, timedFetch } from './spikeEnv'

const token = readEnv('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN')
if (!token) throw new Error('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN not found')
const outIndex = process.argv.indexOf('--out')
const OUT = outIndex > 0 ? process.argv[outIndex + 1]! : '/tmp/spike/routes'
mkdirSync(OUT, { recursive: true })

type LatLon = [number, number]
interface Route {
  id: string
  label: string
  from: LatLon
  to: LatLon
  withAuto?: boolean
}

const ROUTES: Route[] = [
  {
    id: 'wro-oldtown-hala',
    label: 'Wrocław Rynek → Hala Stulecia (old town, park)',
    from: [51.11, 17.032],
    to: [51.1069, 17.0773],
    withAuto: true,
  },
  {
    id: 'wro-tumski',
    label: 'Wrocław pl. Grunwaldzki → pl. Solny via Ostrów Tumski (cobbles)',
    from: [51.112, 17.06],
    to: [51.1093, 17.03],
  },
  {
    id: 'wro-szczytnicki',
    label: 'Wrocław Park Szczytnicki → Opatowicka (park, river dikes)',
    from: [51.114, 17.07],
    to: [51.105, 17.105],
  },
  {
    id: 'wro-odra',
    label: 'Wrocław Kępa Mieszczańska → Zacisze (along the Odra)',
    from: [51.119, 17.017],
    to: [51.124, 17.07],
  },
  {
    id: 'wro-lesnica-mokra',
    label: 'Wrocław Leśnica → Las Mokrzański (suburb, gravel)',
    from: [51.145, 16.865],
    to: [51.1, 16.88],
    withAuto: true,
  },
  {
    id: 'wro-bielany',
    label: 'Wrocław Główny → Bielany Wrocławskie (8 km)',
    from: [51.098, 17.036],
    to: [51.04, 16.96],
  },
  {
    id: 'ber-tempelhof',
    label: 'Berlin across Tempelhofer Feld',
    from: [52.48, 13.387],
    to: [52.47, 13.418],
  },
  {
    id: 'ber-oberbaum',
    label: 'Berlin Görlitzer Park → Boxhagener Platz (Oberbaumbrücke)',
    from: [52.4968, 13.4377],
    to: [52.51, 13.46],
    withAuto: true,
  },
  {
    id: 'ber-nikolai',
    label: 'Berlin Nikolaiviertel → Kollwitzplatz (cobbles)',
    from: [52.517, 13.407],
    to: [52.536, 13.418],
  },
  {
    id: 'ber-spree',
    label: 'Berlin Hauptbahnhof → Schloss Charlottenburg (Spree path)',
    from: [52.525, 13.369],
    to: [52.521, 13.296],
  },
  {
    id: 'ber-grunewald',
    label: 'Berlin S Grunewald → Grunewaldturm (forest, gravel)',
    from: [52.488, 13.261],
    to: [52.472, 13.215],
    withAuto: true,
  },
  {
    id: 'no-path',
    label: 'Wrocław → Reykjavík (no land path)',
    from: [51.11, 17.032],
    to: [64.146, -21.942],
  },
  {
    id: 'no-path-helgoland',
    label: 'Cuxhaven → Helgoland (island, ferry only)',
    from: [53.87, 8.695],
    to: [54.1825, 7.886],
  },
  {
    id: 'no-path-pfaueninsel',
    label: 'Berlin Wannsee → Pfaueninsel (island, ferry only)',
    from: [52.421, 13.179],
    to: [52.433, 13.127],
  },
]
const onlyIndex = process.argv.indexOf('--only')
const SELECTED =
  onlyIndex > 0 ? ROUTES.filter((r) => r.id.startsWith(process.argv[onlyIndex + 1]!)) : ROUTES

const ROUGH = new Set(['paved_rough', 'compacted', 'dirt', 'gravel', 'path', 'impassable'])

interface Result {
  engine: string
  profile: string
  ok: boolean
  distanceM?: number
  durationS?: number
  noPath?: string
  coordinates?: [number, number][]
  surface?: Record<string, number>
  ms: number
}

function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = 10 ** precision
  const points: [number, number][] = []
  let index = 0
  let lat = 0
  let lon = 0
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0
      let shift = 0
      let byte: number
      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 0) lat += delta
      else lon += delta
    }
    points.push([lon / factor, lat / factor])
  }
  return points
}

async function mapbox(route: Route, profile: string): Promise<Result> {
  const coords = `${route.from[1]},${route.from[0]};${route.to[1]},${route.to[0]}`
  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}?geometries=polyline6&overview=full&access_token=${token}`
  const res = await timedFetch(url)
  const body = JSON.parse(res.text)
  const first = body.routes?.[0]
  if (!first)
    return {
      engine: 'mapbox',
      profile,
      ok: false,
      noPath: `HTTP ${res.status} code=${body.code} message=${body.message ?? ''}`,
      ms: res.ms,
    }
  return {
    engine: 'mapbox',
    profile,
    ok: true,
    distanceM: first.distance,
    durationS: first.duration,
    coordinates: decodePolyline(first.geometry),
    ms: res.ms,
  }
}

const VALHALLA = 'https://valhalla1.openstreetmap.de'
const BOARD_OPTIONS = {
  bicycle: { bicycle_type: 'Road', use_roads: 0.2, avoid_bad_surfaces: 1, use_hills: 0.3 },
}

async function valhalla(route: Route, profile: string): Promise<Result> {
  const costing = profile === 'board' ? 'bicycle' : profile
  const body = {
    locations: [
      { lat: route.from[0], lon: route.from[1] },
      { lat: route.to[0], lon: route.to[1] },
    ],
    costing,
    ...(profile === 'board' ? { costing_options: BOARD_OPTIONS } : {}),
    units: 'kilometers',
  }
  const res = await timedFetch(`${VALHALLA}/route`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  const json = JSON.parse(res.text)
  const trip = json.trip
  if (!trip)
    return {
      engine: 'valhalla',
      profile,
      ok: false,
      noPath: `HTTP ${res.status} error_code=${json.error_code} error=${json.error}`,
      ms: res.ms,
    }
  return {
    engine: 'valhalla',
    profile,
    ok: true,
    distanceM: trip.summary.length * 1000,
    durationS: trip.summary.time,
    coordinates: trip.legs.flatMap((leg: { shape: string }) => decodePolyline(leg.shape)),
    ms: res.ms,
  }
}

async function brouter(route: Route, profile: string): Promise<Result> {
  const url = `https://brouter.de/brouter?lonlats=${route.from[1]},${route.from[0]}|${route.to[1]},${route.to[0]}&profile=${profile}&alternativeidx=0&format=geojson`
  const res = await timedFetch(url)
  if (res.status !== 200)
    return {
      engine: 'brouter',
      profile,
      ok: false,
      noPath: `HTTP ${res.status} ${res.text.slice(0, 120)}`,
      ms: res.ms,
    }
  const feature = JSON.parse(res.text).features[0]
  const props = feature.properties
  // messages: header row then rows; columns include Distance and WayTags.
  const [header, ...rows] = props.messages as string[][]
  const distanceCol = header!.indexOf('Distance')
  const tagsCol = header!.indexOf('WayTags')
  const surface: Record<string, number> = {}
  for (const row of rows) {
    const tags = row[tagsCol] ?? ''
    const value =
      /surface=(\S+)/.exec(tags)?.[1] ??
      (/highway=(track|path)/.test(tags) ? 'unknown-track' : 'unknown')
    surface[value] = (surface[value] ?? 0) + Number(row[distanceCol])
  }
  return {
    engine: 'brouter',
    profile,
    ok: true,
    distanceM: Number(props['track-length']),
    durationS: Number(props['total-time']),
    coordinates: feature.geometry.coordinates.map((c: number[]) => [c[0], c[1]]),
    surface,
    ms: res.ms,
  }
}

function encodePolyline(points: [number, number][], precision = 6) {
  const factor = 10 ** precision
  let out = ''
  let prevLat = 0
  let prevLon = 0
  const encode = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    out += String.fromCharCode(v + 63)
  }
  for (const [lon, lat] of points) {
    const la = Math.round(lat * factor)
    const lo = Math.round(lon * factor)
    encode(la - prevLat)
    encode(lo - prevLon)
    prevLat = la
    prevLon = lo
  }
  return out
}

/** Metres per Valhalla surface class along a line, by map-matching it onto OSM. */
async function surfaceOf(coordinates: [number, number][], costing: string) {
  const body = {
    encoded_polyline: encodePolyline(coordinates),
    costing,
    shape_match: 'map_snap',
    filters: { attributes: ['edge.surface', 'edge.length'], action: 'include' },
  }
  const res = await timedFetch(`${VALHALLA}/trace_attributes`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  const json = JSON.parse(res.text)
  if (!json.edges) return { error: `trace HTTP ${res.status} ${json.error ?? ''}` }
  const surface: Record<string, number> = {}
  for (const edge of json.edges as { surface?: string; length: number }[]) {
    const key = edge.surface ?? 'unknown'
    surface[key] = (surface[key] ?? 0) + edge.length * 1000
  }
  return surface
}

function roughShare(surface: Record<string, number> | undefined, brouterTags = false) {
  if (!surface) return null
  const total = Object.values(surface).reduce((a, b) => a + b, 0)
  if (!total) return null
  const roughKeys = brouterTags
    ? (key: string) =>
        /sett|cobble|unhewn|gravel|compacted|fine_gravel|dirt|ground|grass|sand|unpaved|pebble|unknown-track/.test(
          key,
        )
    : (key: string) => ROUGH.has(key)
  const rough = Object.entries(surface)
    .filter(([key]) => roughKeys(key))
    .reduce((sum, [, v]) => sum + v, 0)
  return rough / total
}

const pct = (value: number | null) =>
  value == null ? '  n/m' : `${(value * 100).toFixed(0).padStart(4)}%`

const summary: Record<string, unknown>[] = []
try {
  for (const route of SELECTED) {
    console.log(`\n### ${route.id}: ${route.label}`)
    const results: Result[] = []
    for (const profile of ['walking', 'cycling', ...(route.withAuto ? ['driving'] : [])])
      results.push(await mapbox(route, profile))
    for (const profile of ['pedestrian', 'bicycle', 'board', ...(route.withAuto ? ['auto'] : [])]) {
      results.push(await valhalla(route, profile))
      await sleep(1200)
    }
    results.push(await brouter(route, 'trekking'))
    await sleep(1200)

    // Surface for the lines that matter for the board question.
    for (const result of results) {
      if (!result.ok || !result.coordinates) continue
      const wanted =
        (result.engine === 'mapbox' && result.profile !== 'driving') ||
        (result.engine === 'valhalla' && result.profile === 'board')
      if (!wanted) continue
      const surface = await surfaceOf(
        result.coordinates,
        result.profile === 'walking' ? 'pedestrian' : 'bicycle',
      )
      if ('error' in surface)
        console.log(`  surface for ${result.engine}/${result.profile}: ${surface.error}`)
      else result.surface = surface as Record<string, number>
      await sleep(1200)
    }

    for (const r of results) {
      const rough = roughShare(r.surface, r.engine === 'brouter')
      const line = r.ok
        ? `${(r.distanceM! / 1000).toFixed(2).padStart(6)} km ${(r.durationS! / 60).toFixed(1).padStart(6)} min  rough ${pct(rough)}`
        : `NO ROUTE: ${redact(r.noPath ?? '')}`
      console.log(`  ${r.engine.padEnd(8)} ${r.profile.padEnd(10)} ${line}  (${r.ms} ms)`)
      summary.push({
        route: route.id,
        engine: r.engine,
        profile: r.profile,
        ok: r.ok,
        distanceM: r.distanceM,
        durationS: r.durationS,
        rough,
        surface: r.surface,
        noPath: r.noPath,
      })
    }

    const features = results
      .filter((r) => r.ok)
      .map((r) => ({
        type: 'Feature',
        properties: {
          engine: r.engine,
          profile: r.profile,
          distanceM: r.distanceM,
          durationS: r.durationS,
          surface: r.surface,
        },
        geometry: { type: 'LineString', coordinates: r.coordinates },
      }))
    writeFileSync(
      join(OUT, `${route.id}.geojson`),
      JSON.stringify({ type: 'FeatureCollection', features }),
    )
  }
} catch (error) {
  console.error(redact(String(error instanceof Error ? error.stack : error)))
  process.exit(1)
}

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(`\nGeoJSON and summary.json written to ${OUT}`)
