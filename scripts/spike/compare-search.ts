/**
 * Spike #660: same place searches and reverse lookups against Mapbox (the calls the server proxy
 * makes) and public Photon, mapped to the app's `MapSearchResult` shape and printed side by side.
 *
 *   bun run scripts/spike/compare-search.ts [--json out.json]
 *
 * Photon is a shared community server: one request at a time, 1 s apart.
 */
import { writeFileSync } from 'node:fs'

import { readEnv, redact, sleep, timedFetch } from './spikeEnv'

const token = readEnv('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN')
if (!token) throw new Error('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN not found')

const WROCLAW = { lat: 51.1079, lon: 17.0385 }
const BERLIN = { lat: 52.52, lon: 13.405 }
type Point = typeof WROCLAW

interface Result {
  id: string
  title: string
  subtitle: string
  latitude: number
  longitude: number
  category: string | null
}

const QUERIES: [string, Point][] = [
  ['Rynek 1, Wrocław', WROCLAW],
  ['Legnicka 58 Wrocław', WROCLAW],
  ['plac Grunwaldzki 22', WROCLAW],
  ['ul. Świdnicka', WROCLAW],
  ['Swidnicka', WROCLAW],
  ['Hala Stulecia', WROCLAW],
  ['Ostrów Tumski', WROCLAW],
  ['Ostrow Tumski', WROCLAW],
  ['Most Grunwaldzki', WROCLAW],
  ['Park Szczytnicki', WROCLAW],
  ['Wyspa Słodowa', WROCLAW],
  ['Sky Tower', WROCLAW],
  ['Dworzec Główny', WROCLAW],
  ['pump track', WROCLAW],
  ['sklep rowerowy', WROCLAW],
  ['skatepark', WROCLAW],
  ['stacja paliw', WROCLAW],
  ['wroc', WROCLAW],
  ['Oława', WROCLAW],
  ['Olawa', WROCLAW],
  ['Sobótka', WROCLAW],
  ['Hala Stulecja', WROCLAW],
  ['Żmigród', WROCLAW],
  ['Kraków', WROCLAW],
  ['Alexanderplatz', BERLIN],
  ['alexanderpl', BERLIN],
  ['Tempelhofer Feld', BERLIN],
  ['Tempelhofer Fled', BERLIN],
  ['Unter den Linden 1', BERLIN],
  ['Karl-Marx-Allee 100, Berlin', BERLIN],
  ['Oranienstraße', BERLIN],
  ['Oranienstrasse', BERLIN],
  ['Görlitzer Park', BERLIN],
  ['Gorlitzer Park', BERLIN],
  ['Fahrradladen', BERLIN],
  ['Skatepark', BERLIN],
  ['Oberbaumbrücke', BERLIN],
  ['Brandenburger Tor', BERLIN],
  ['Potsdam', BERLIN],
  ['Müggelsee', BERLIN],
]

const REVERSE: [string, Point][] = [
  ['Rynek, Wrocław', { lat: 51.1101, lon: 17.0319 }],
  ['Park Szczytnicki path', { lat: 51.1132, lon: 17.0836 }],
  ['Las Osobowicki forest track', { lat: 51.1505, lon: 16.9905 }],
  ['Most Grunwaldzki bridge', { lat: 51.1101, lon: 17.0525 }],
  ['Odra embankment path', { lat: 51.1225, lon: 17.0565 }],
  ['Wyspa Słodowa', { lat: 51.1153, lon: 17.0352 }],
  ['Las Mokrzański', { lat: 51.0965, lon: 16.8835 }],
  ['Ślęża summit trail', { lat: 50.8649, lon: 16.7084 }],
  ['Fields near Kobierzyce', { lat: 51.0215, lon: 16.9502 }],
  ['Tempelhofer Feld runway', { lat: 52.4733, lon: 13.4018 }],
  ['Oberbaumbrücke', { lat: 52.5016, lon: 13.4456 }],
  ['Grunewald forest track', { lat: 52.4825, lon: 13.2368 }],
  ['Tiergarten path', { lat: 52.5145, lon: 13.3501 }],
  ['Spree river path', { lat: 52.5195, lon: 13.372 }],
  ['Alexanderplatz', { lat: 52.5219, lon: 13.4132 }],
]

// --- Mapbox: what the app's search.ts does ---------------------------------------------------

interface MapboxFeature {
  id?: string
  text?: string
  place_name?: string
  geometry?: { coordinates?: [number, number] }
  properties?: Record<string, unknown> & {
    mapbox_id?: string
    name?: string
    full_address?: string
    place_formatted?: string
    poi_category?: string[]
    maki?: string
  }
}

function mapboxResult(feature: MapboxFeature): Result | null {
  const [longitude, latitude] = feature.geometry?.coordinates ?? []
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
  const p = feature.properties ?? {}
  const title = p.name ?? feature.text ?? 'Unnamed place'
  const maki = p.maki && p.maki !== 'marker' ? p.maki.replaceAll('-', ' ') : null
  return {
    id: p.mapbox_id ?? feature.id ?? `${longitude},${latitude}`,
    title,
    subtitle:
      (p.full_address && p.place_formatted
        ? p.full_address
        : p.full_address || p.place_formatted) ||
      feature.place_name ||
      'Mapbox result',
    latitude,
    longitude,
    category: [...(p.poi_category ?? []), ...(maki ? [maki] : [])].join(' ') || null,
  }
}

async function mapboxSearch(q: string, near: Point) {
  const url = new URL('https://api.mapbox.com/search/searchbox/v1/forward')
  url.searchParams.set('q', q)
  url.searchParams.set('limit', '10')
  url.searchParams.set('proximity', `${near.lon},${near.lat}`)
  url.searchParams.set('access_token', token!)
  const res = await timedFetch(url.toString())
  const features = (JSON.parse(res.text).features ?? []) as MapboxFeature[]
  return {
    ms: res.ms,
    status: res.status,
    results: features.map(mapboxResult).filter((r) => r != null),
  }
}

async function mapboxReverse(at: Point) {
  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${at.lon},${at.lat}.json`)
  url.searchParams.set('limit', '1')
  url.searchParams.set('access_token', token!)
  const res = await timedFetch(url.toString())
  const feature = (JSON.parse(res.text).features ?? [])[0] as MapboxFeature | undefined
  return { ms: res.ms, status: res.status, result: feature ? mapboxResult(feature) : null }
}

// --- Photon: proposed mapping -----------------------------------------------------------------

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: Record<string, string | undefined>
}

/** Category from OSM tags: `osm_value` (e.g. `bicycle`, `fuel`, `skate_park`) plus `osm_key`. */
function photonCategory(p: PhotonFeature['properties']) {
  const value = p.osm_value?.replaceAll('_', ' ')
  if (!value || value === 'yes') return null
  return [value, p.osm_key].filter(Boolean).join(' ')
}

function photonResult(feature: PhotonFeature): Result {
  const p = feature.properties
  const [longitude, latitude] = feature.geometry.coordinates
  const street = [p.street, p.housenumber].filter(Boolean).join(' ')
  const title = p.name ?? (street || p.city || 'Unnamed place')
  const subtitle = [p.name ? street : null, p.postcode, p.city ?? p.district ?? p.county, p.country]
    .filter((part) => part && part !== title)
    .join(', ')
  return {
    id: `osm:${p.osm_type}${p.osm_id}`,
    title,
    subtitle: subtitle || p.type || 'Photon result',
    latitude,
    longitude,
    category: photonCategory(p),
  }
}

async function photonSearch(q: string, near: Point) {
  const url = new URL('https://photon.komoot.io/api')
  url.searchParams.set('q', q)
  url.searchParams.set('lat', String(near.lat))
  url.searchParams.set('lon', String(near.lon))
  url.searchParams.set('limit', '10')
  const res = await timedFetch(url.toString())
  if (res.status !== 200) return { ms: res.ms, status: res.status, results: [] as Result[] }
  const features = (JSON.parse(res.text).features ?? []) as PhotonFeature[]
  return { ms: res.ms, status: res.status, results: features.map(photonResult) }
}

async function photonReverse(at: Point) {
  const url = new URL('https://photon.komoot.io/reverse')
  url.searchParams.set('lat', String(at.lat))
  url.searchParams.set('lon', String(at.lon))
  url.searchParams.set('limit', '1')
  const res = await timedFetch(url.toString())
  const feature = res.status === 200 ? (JSON.parse(res.text).features ?? [])[0] : undefined
  return { ms: res.ms, status: res.status, result: feature ? photonResult(feature) : null }
}

// --- Run ------------------------------------------------------------------------------------

/** The app's `prioritizeNearbySearchResults`: within 150 km first, then top 5. */
function rank(results: Result[], near: Point) {
  const km = (r: Result) => {
    const dLat = ((r.latitude - near.lat) * Math.PI) / 180
    const dLon = ((r.longitude - near.lon) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((near.lat * Math.PI) / 180) *
        Math.cos((r.latitude * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2
    return 6371 * 2 * Math.asin(Math.sqrt(a))
  }
  return [...results.filter((r) => km(r) <= 150), ...results.filter((r) => km(r) > 150)].slice(0, 5)
}

const line = (r: Result | null) =>
  r
    ? `${r.title} | ${r.subtitle} | ${r.category ?? '-'} | ${r.latitude.toFixed(4)},${r.longitude.toFixed(4)}`
    : '(none)'

const report: Record<string, unknown>[] = []
const latency = { mapbox: [] as number[], photon: [] as number[] }

try {
  for (const [q, near] of QUERIES) {
    const mapbox = await mapboxSearch(q, near)
    const photon = await photonSearch(q, near)
    latency.mapbox.push(mapbox.ms)
    latency.photon.push(photon.ms)
    const m = rank(mapbox.results, near)
    const p = rank(photon.results, near)
    console.log(
      `\n### "${q}" (near ${near === WROCLAW ? 'Wrocław' : 'Berlin'})  mapbox ${mapbox.ms} ms, photon ${photon.ms} ms${photon.status !== 200 ? ` [photon HTTP ${photon.status}]` : ''}`,
    )
    for (let i = 0; i < 5; i++)
      console.log(`  ${i + 1}. M: ${line(m[i] ?? null)}\n     P: ${line(p[i] ?? null)}`)
    report.push({
      kind: 'search',
      q,
      mapbox: m,
      photon: p,
      ms: { mapbox: mapbox.ms, photon: photon.ms },
    })
    await sleep(1000)
  }

  for (const [label, at] of REVERSE) {
    const mapbox = await mapboxReverse(at)
    const photon = await photonReverse(at)
    latency.mapbox.push(mapbox.ms)
    latency.photon.push(photon.ms)
    console.log(
      `\n### reverse ${label} (${at.lat},${at.lon})  mapbox ${mapbox.ms} ms, photon ${photon.ms} ms`,
    )
    console.log(`  M: ${line(mapbox.result)}\n  P: ${line(photon.result)}`)
    report.push({
      kind: 'reverse',
      label,
      mapbox: mapbox.result,
      photon: photon.result,
      ms: { mapbox: mapbox.ms, photon: photon.ms },
    })
    await sleep(1000)
  }
} catch (error) {
  console.error(redact(String(error)))
  process.exit(1)
}

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return `median ${sorted[Math.floor(sorted.length / 2)]} ms, p90 ${sorted[Math.floor(sorted.length * 0.9)]} ms`
}
console.log(`\nLatency: mapbox ${stats(latency.mapbox)}; photon ${stats(latency.photon)}`)

const jsonIndex = process.argv.indexOf('--json')
if (jsonIndex > 0) writeFileSync(process.argv[jsonIndex + 1]!, JSON.stringify(report, null, 2))
