import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Generates the Watch Frame lane fixtures the Wear Mirror replays on an emulator
 * (`watch/wearos/src/main/assets/`), so wrist visuals can be worked on without a board, a phone or
 * a ride.
 *
 * The watch only ever sees decoded lanes (ADR-0019), never board protocol, so the fixtures are
 * lane-only JSONL — a Debug Recording replayed here on the host, not on the watch:
 *
 *   replay-thor301.jsonl -> reassemble rx packets -> Refloat ALLDATA -> lanes -> watch-ride.jsonl
 *
 * The decode mirrors `VescPacketReassembler` + `parseRefloatGetAllData`; the SoC lane mirrors
 * `BatterySocEstimator` manual mode, since the recording carries no Board battery config.
 * `watch-sweep.jsonl` is synthetic: every lane walked through its full range, including null and
 * stale stretches, so gauge extremes are reachable without hunting for them in a real ride.
 *
 * Navigation is synthetic: a route polyline (`watch-route.json`) plus per-sample rider lanes walking
 * it, with a geographic origin at the recording's first GPS fix. GPS movement continues after the
 * destination clears, so both navigation and a standalone map are reachable on an emulator. The
 * forecast (`watch-weather.json`) is synthetic too. The street map under it is a handful of real
 * dark-style tiles along the walked route (`watch-map-tiles/`), so between them the emulator shows
 * every wrist surface without a phone or a network.
 *
 * Tiles download only when missing, with `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` (Bun reads `.env.local`);
 * the committed fixtures are the JPEGs alone.
 */

const ROOT = join(import.meta.dir, '..')
const SOURCE = join(ROOT, 'shared', 'fixtures', 'replay-thor301.jsonl')
const OUT_DIR = join(ROOT, 'watch', 'wearos', 'src', 'main', 'assets')
const MAP_TILE_DIR = join(OUT_DIR, 'watch-map-tiles')

/** The hosted dark street-map style, as `MapTiles.STYLE` fetches it. */
const MAP_STYLE = 'kacperkozak/cmux9d4th002j01s4fm7tc4mt'

/**
 * The level the phone planner (`watchMapTileZoom`) picks for the replayed span: 400 m on a 480 px
 * face at Wrocław's latitude is 0.83 m/px, and z16 is the lowest level whose 512 px tile is drawn at
 * most 1.3x its size there (z15 would be 2.6x).
 */
const MAP_TILE_ZOOM = 16

/** Tiles within this many metres of any replayed rider position: the face diagonal at the span. */
const MAP_TILE_REACH_M = 300

/** Watch tick cadence (`wearPushRateHz` default), so a replayed lane stream is paced like a real push. */
const SAMPLE_INTERVAL_MS = 500

const COMM_CUSTOM_APP_DATA = 36
const REFLOAT_MAGIC = 101
const REFLOAT_GET_ALLDATA = 10
const REFLOAT_FAULT_MODE = 69

/** Manual-mode SoC shape from `BatterySocEstimator.MANUAL_CURVE`: pack-voltage fraction -> percent. */
const MANUAL_CURVE: [norm: number, soc: number][] = [
  [1.0, 100],
  [0.95, 90],
  [0.9, 75],
  [0.82, 55],
  [0.72, 35],
  [0.55, 18],
  [0.35, 7],
  [0.15, 2],
  [0.0, 0],
]
const DEFAULT_INTERNAL_RESISTANCE_MILLIOHM = 18
const CELL_MIN_V = 3.1
const CELL_MAX_V = 4.2

type LaneSample = {
  t: number
  speed: number
  duty: number | null
  battery: number | null
  motorTemp: number | null
  ctrlTemp: number | null
  stale?: boolean
  /** Nav lanes. Omitted entirely on samples with no destination, which is how the watch hides nav. */
  navBearing?: number
  navDistance?: number
  /** Simulated GPS in metres from the route origin, retained independently of Navigation. */
  riderEast?: number
  riderNorth?: number
  course?: number
  routeSpanM?: number
}

/** A synthetic route point in the wrist's drawing frame: metres east/north of the route origin. */
type RoutePoint = { east: number; north: number }

type GeoPoint = { latitude: number; longitude: number }

function crc16(data: Uint8Array): number {
  let crc = 0
  for (const byte of data) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc
}

/** Streaming packet reassembler, mirroring `VescPacketReassembler`. */
class PacketReassembler {
  private buffer: number[] = []

  feed(chunk: Uint8Array): Uint8Array[] {
    for (const byte of chunk) this.buffer.push(byte)
    const packets: Uint8Array[] = []
    while (this.buffer.length > 0) {
      const start = this.buffer[0]
      if (start !== 0x02 && start !== 0x03) {
        this.buffer.shift()
        continue
      }
      const headerLen = start === 0x02 ? 2 : 3
      if (this.buffer.length < headerLen) break
      const len = start === 0x02 ? this.buffer[1] : (this.buffer[1] << 8) | this.buffer[2]
      const total = headerLen + len + 3
      if (this.buffer.length < total) break
      if (this.buffer[total - 1] !== 0x03) {
        this.buffer.shift()
        continue
      }
      const payload = Uint8Array.from(this.buffer.slice(headerLen, headerLen + len))
      const actual = (this.buffer[headerLen + len] << 8) | this.buffer[headerLen + len + 1]
      if (crc16(payload) === actual) {
        packets.push(payload)
        this.buffer.splice(0, total)
      } else {
        this.buffer.shift()
      }
    }
    return packets
  }
}

function int16(payload: Uint8Array, offset: number): number {
  const raw = (payload[offset] << 8) | payload[offset + 1]
  return raw >= 0x8000 ? raw - 0x10000 : raw
}

type Telemetry = {
  speed: number
  dutyCycle: number
  batteryVoltage: number
  batteryCurrent: number
  tempMotor: number | null
  tempMosfet: number | null
}

/** Refloat ALLDATA -> telemetry, mirroring `parseRefloatGetAllData` (fault frames dropped). */
function parseAllData(payload: Uint8Array): Telemetry | null {
  if (payload.length < 5) return null
  if (payload[0] !== COMM_CUSTOM_APP_DATA) return null
  if (payload[1] !== REFLOAT_MAGIC) return null
  if (payload[2] !== REFLOAT_GET_ALLDATA) return null
  const mode = payload[3]
  if (mode === REFLOAT_FAULT_MODE) return null
  if (payload.length < 34) return null

  const dutyRaw = payload[33] - 128
  const hasExtended = mode >= 2 && payload.length >= 42
  return {
    speed: (int16(payload, 27) / 10) * 3.6,
    dutyCycle: Math.abs(dutyRaw) <= 1 ? 0 : dutyRaw / 100,
    batteryVoltage: int16(payload, 23) / 10,
    batteryCurrent: int16(payload, 31) / 10,
    tempMotor: hasExtended ? payload[40] / 2 : null,
    tempMosfet: hasExtended ? payload[39] / 2 : null,
  }
}

/**
 * Sag-corrected pack voltage -> SoC percent. The recording carries no Board battery config, so the
 * series count is inferred from the highest voltage seen and the pack is assumed 2P, matching the
 * assumptions `BatterySocEstimator` manual mode already makes.
 */
function estimateSoc(voltageV: number, currentA: number, seriesCount: number): number {
  const rPackOhm = ((DEFAULT_INTERNAL_RESISTANCE_MILLIOHM / 1000) * seriesCount) / 2
  const corrected = voltageV + currentA * rPackOhm
  const norm = (corrected - CELL_MIN_V * seriesCount) / ((CELL_MAX_V - CELL_MIN_V) * seriesCount)
  if (norm >= 1) return 100
  if (norm <= 0) return 0
  for (let i = 0; i < MANUAL_CURVE.length - 1; i++) {
    const [hiNorm, hiSoc] = MANUAL_CURVE[i]
    const [loNorm, loSoc] = MANUAL_CURVE[i + 1]
    if (norm <= hiNorm && norm >= loNorm) {
      const span = hiNorm - loNorm
      const t = span > 0 ? (norm - loNorm) / span : 0
      return loSoc + t * (hiSoc - loSoc)
    }
  }
  return 0
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function serialize(samples: LaneSample[]): string {
  return samples.map((sample) => JSON.stringify(sample)).join('\n') + '\n'
}

type CaptureRecord = {
  t?: number
  kind?: string
  direction?: string
  base64?: string
  latitude?: number
  longitude?: number
}

function readCapture(): CaptureRecord[] {
  const records: CaptureRecord[] = []
  let malformedLines = 0
  for (const line of readFileSync(SOURCE, 'utf8').split('\n')) {
    if (!line) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      malformedLines += 1
    }
  }
  if (malformedLines > 0) console.warn(`Skipped ${malformedLines} malformed capture lines.`)
  return records
}

const CAPTURE = readCapture()

/** Where the synthetic route starts: the recording's first GPS fix, rounded to the wire's microdegrees. */
function routeOrigin(): GeoPoint {
  const fix = CAPTURE.find((record) => record.kind === 'location')
  if (fix?.latitude === undefined || fix.longitude === undefined) {
    throw new Error('the recording has no GPS fix to anchor the route')
  }
  return { latitude: round(fix.latitude, 6), longitude: round(fix.longitude, 6) }
}

const ORIGIN = routeOrigin()

/** Decodes the recorded ride into one telemetry sample per parsed ALLDATA packet. */
function decodeRide(): { t: number; telemetry: Telemetry }[] {
  const reassembler = new PacketReassembler()
  const decoded: { t: number; telemetry: Telemetry }[] = []
  for (const record of CAPTURE) {
    if (record.kind !== 'ble-chunk' || record.direction !== 'rx' || !record.base64) continue
    const chunk = Uint8Array.from(Buffer.from(record.base64, 'base64'))
    for (const packet of reassembler.feed(chunk)) {
      const telemetry = parseAllData(packet)
      if (telemetry) decoded.push({ t: record.t ?? 0, telemetry })
    }
  }
  return decoded
}

/**
 * The synthetic route the rider follows: ~3 km of straights joined by every turn shape the wrist has
 * to survive — 30/60/90/120/160°, taken both as sharp corners and as swept arcs, including a
 * hairpin. Curvature has to live at the scale the wrist actually shows ([ROUTE_SPAN_M]): one long
 * gentle arc renders as a straight line once it is cropped to the few hundred metres ahead, and a
 * route with no hard turns never exercises the heading-up rotation.
 *
 * Fixed script, not a random source: the fixture is checked in, so every run must produce the same
 * corners.
 */
type RouteSegment =
  | { straightM: number }
  /** [radiusM] 0 is a sharp corner; anything larger sweeps the turn as an arc. */
  | { turnDeg: number; radiusM: number }

const ROUTE_SCRIPT: RouteSegment[] = [
  { straightM: 200 },
  { turnDeg: 30, radiusM: 45 },
  { straightM: 150 },
  { turnDeg: -60, radiusM: 0 },
  { straightM: 130 },
  { turnDeg: 60, radiusM: 35 },
  { straightM: 180 },
  { turnDeg: -90, radiusM: 0 },
  { straightM: 160 },
  { turnDeg: 90, radiusM: 30 },
  { straightM: 220 },
  { turnDeg: -120, radiusM: 25 },
  { straightM: 140 },
  { turnDeg: 120, radiusM: 0 },
  { straightM: 190 },
  // Hairpin: the worst case for heading-up rotation, since the whole drawing spins nearly halfway.
  { turnDeg: 160, radiusM: 20 },
  { straightM: 240 },
  { turnDeg: -30, radiusM: 0 },
  { straightM: 210 },
  { turnDeg: -160, radiusM: 55 },
  { straightM: 300 },
]

/** Metres between polyline points on a straight; arcs subdivide by angle instead. */
const ROUTE_STEP_M = 25
const ROUTE_ARC_STEP_DEG = 8

function buildRoute(): RoutePoint[] {
  const points: RoutePoint[] = [{ east: 0, north: 0 }]
  let headingDeg = 0
  let east = 0
  let north = 0

  const advance = (distanceM: number) => {
    const rad = (headingDeg * Math.PI) / 180
    east += Math.sin(rad) * distanceM
    north += Math.cos(rad) * distanceM
    points.push({ east: round(east), north: round(north) })
  }

  for (const segment of ROUTE_SCRIPT) {
    if ('straightM' in segment) {
      const steps = Math.max(1, Math.round(segment.straightM / ROUTE_STEP_M))
      for (let step = 0; step < steps; step++) advance(segment.straightM / steps)
      continue
    }
    if (segment.radiusM === 0) {
      headingDeg += segment.turnDeg
      continue
    }
    // Swept turn: walk the arc in small heading steps, each chord long enough to keep the radius.
    const steps = Math.max(1, Math.round(Math.abs(segment.turnDeg) / ROUTE_ARC_STEP_DEG))
    const stepDeg = segment.turnDeg / steps
    const chordM = 2 * segment.radiusM * Math.sin((Math.abs(stepDeg) * Math.PI) / 360)
    for (let step = 0; step < steps; step++) {
      headingDeg += stepDeg
      advance(chordM)
    }
  }
  return points
}

const ROUTE = buildRoute()
const ROUTE_LEGS = ROUTE.slice(1).map((point, index) => distance(ROUTE[index], point))
const ROUTE_LENGTH_M = ROUTE_LEGS.reduce((sum, leg) => sum + leg, 0)

/** Horizontal route metres the phone map shows; the wrist zooms its route drawing to match. */
const ROUTE_SPAN_M = 400

function distance(from: RoutePoint, to: RoutePoint): number {
  return Math.hypot(to.east - from.east, to.north - from.north)
}

/** Degrees clockwise from north, the convention every rider lane uses. */
function bearing(from: RoutePoint, to: RoutePoint): number {
  return ((Math.atan2(to.east - from.east, to.north - from.north) * 180) / Math.PI + 360) % 360
}

/** Walk the route, then continue along the final leg after passing the destination. */
function walkRoute(alongM: number): { point: RoutePoint; courseDeg: number } {
  let remaining = Math.max(alongM, 0)
  for (let index = 0; index < ROUTE_LEGS.length; index++) {
    const leg = ROUTE_LEGS[index]
    if (remaining > leg && index < ROUTE_LEGS.length - 1) {
      remaining -= leg
      continue
    }
    const from = ROUTE[index]
    const to = ROUTE[index + 1]
    const fraction = leg === 0 ? 0 : remaining / leg
    return {
      point: {
        east: from.east + (to.east - from.east) * fraction,
        north: from.north + (to.north - from.north) * fraction,
      },
      courseDeg: bearing(from, to),
    }
  }
  return { point: ROUTE[ROUTE.length - 1], courseDeg: 0 }
}

/**
 * Synthetic nav + rider lanes for [progress] through a fixture (0 = start, 1 = end): the rider walks
 * the route towards its far end, so the chevron, the distance and the drawn line all agree instead
 * of each telling its own story. Past arrival only destination lanes disappear; GPS movement
 * continues so the position ring and ridden trail remain on the standalone map.
 */
function mapLanes(progress: number): Partial<LaneSample> {
  const ARRIVAL_AT = 0.85
  const alongM = (progress / ARRIVAL_AT) * ROUTE_LENGTH_M
  const { point, courseDeg } = walkRoute(alongM)
  const destination = ROUTE[ROUTE.length - 1]
  return {
    ...(progress < ARRIVAL_AT
      ? {
          // Bearing is relative to travel direction: straight ahead is up on the wrist.
          navBearing: round((bearing(point, destination) - courseDeg + 360) % 360),
          navDistance: round(Math.max(15, ROUTE_LENGTH_M - alongM)),
        }
      : {}),
    riderEast: round(point.east),
    riderNorth: round(point.north),
    course: round(courseDeg),
    routeSpanM: ROUTE_SPAN_M,
  }
}

/**
 * Synthetic forecast for the wrist's weather surfaces. Hours carry no clock time: the replayer
 * anchors them to the emulator's own clock, so the strip always reads as "the hours ahead".
 */
function buildWeather() {
  const icons = ['sun', 'cloud-sun', 'cloud', 'cloud-rain', 'cloud-lightning', 'cloud-snow']
  return {
    temperatureC: 17,
    icon: 'cloud-sun',
    label: 'Partly cloudy',
    precipitationProbability: 15,
    sunriseMinuteOfDay: 5 * 60 + 12,
    sunsetMinuteOfDay: 20 * 60 + 48,
    latitude: 52.2297,
    longitude: 21.0122,
    hourly: Array.from({ length: 12 }, (_, hour) => ({
      temperatureC: 17 + Math.round(6 * Math.sin((hour / 12) * Math.PI)),
      icon: icons[hour % icons.length],
      precipitationProbability: (hour * 13) % 90,
    })),
  }
}

/** Resamples the decoded ride onto the watch tick grid — latest-sample-wins, like the cold path. */
function buildRide(): LaneSample[] {
  const decoded = decodeRide()
  if (decoded.length === 0) throw new Error('no Refloat ALLDATA packets decoded from the recording')

  const peakVoltage = Math.max(...decoded.map((entry) => entry.telemetry.batteryVoltage))
  const seriesCount = Math.max(1, Math.round(peakVoltage / CELL_MAX_V))

  const samples: LaneSample[] = []
  const endMs = decoded[decoded.length - 1].t
  let cursor = 0
  for (let t = decoded[0].t; t <= endMs; t += SAMPLE_INTERVAL_MS) {
    while (cursor + 1 < decoded.length && decoded[cursor + 1].t <= t) cursor++
    const { telemetry } = decoded[cursor]
    const progress = (t - decoded[0].t) / Math.max(1, endMs - decoded[0].t)
    samples.push({
      t: t - decoded[0].t,
      speed: round(Math.abs(telemetry.speed)),
      duty: round(Math.abs(telemetry.dutyCycle) * 100),
      battery: round(estimateSoc(telemetry.batteryVoltage, telemetry.batteryCurrent, seriesCount)),
      motorTemp: telemetry.tempMotor === null ? null : round(telemetry.tempMotor),
      ctrlTemp: telemetry.tempMosfet === null ? null : round(telemetry.tempMosfet),
      ...mapLanes(progress),
    })
  }
  console.log(
    `watch-ride: ${samples.length} samples, ${Math.round(endMs / 1000)}s, ${seriesCount}s pack`,
  )
  return samples
}

/**
 * Full-range lane walk: every gauge from empty to redline and back, then a null stretch (lanes the
 * board did not report) and a stale stretch, so degraded rendering is reachable in a few seconds.
 */
function buildSweep(): LaneSample[] {
  const samples: LaneSample[] = []
  const rampSteps = 60
  const push = (sample: Omit<LaneSample, 't'>) =>
    samples.push({ t: samples.length * SAMPLE_INTERVAL_MS, ...sample })

  for (let step = 0; step <= rampSteps; step++) {
    const p = step / rampSteps
    push({
      speed: round(p * 60),
      duty: round(p * 100),
      battery: round(100 - p * 100),
      motorTemp: round(20 + p * 90),
      ctrlTemp: round(20 + p * 80),
      ...mapLanes(p * 0.5),
    })
  }
  for (let step = rampSteps; step >= 0; step--) {
    const p = step / rampSteps
    push({
      speed: round(p * 60),
      duty: round(p * 100),
      battery: round(100 - p * 100),
      motorTemp: round(20 + p * 90),
      ctrlTemp: round(20 + p * 80),
      ...mapLanes(1 - p * 0.5),
    })
  }
  for (let step = 0; step < 10; step++) {
    push({ speed: 12, duty: null, battery: null, motorTemp: null, ctrlTemp: null })
  }
  for (let step = 0; step < 10; step++) {
    push({ speed: 32.5, duty: 48, battery: 61, motorTemp: 52, ctrlTemp: 44, stale: true })
  }
  console.log(`watch-sweep: ${samples.length} samples`)
  return samples
}

/** Web Mercator tile coordinates of [point] at [zoom], fractional. */
function tileCoordinates(point: GeoPoint, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom
  const lat = (point.latitude * Math.PI) / 180
  return {
    x: ((point.longitude + 180) / 360) * n,
    y: ((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2) * n,
  }
}

/** Metres east/north of [ORIGIN] as a position: the inverse the wrist applies (`offsetFrom`). */
function geoAt(east: number, north: number): GeoPoint {
  return {
    latitude: ORIGIN.latitude + north / 110_574,
    longitude: ORIGIN.longitude + east / (111_320 * Math.cos((ORIGIN.latitude * Math.PI) / 180)),
  }
}

/** Every [MAP_TILE_ZOOM] tile reaching within [MAP_TILE_REACH_M] of a replayed rider position. */
function mapTileKeys(fixtures: LaneSample[][]): string[] {
  const tileM = (40_075_016.7 * Math.cos((ORIGIN.latitude * Math.PI) / 180)) / 2 ** MAP_TILE_ZOOM
  const reach = MAP_TILE_REACH_M / tileM
  const keys = new Set<string>()
  for (const sample of fixtures.flat()) {
    if (sample.riderEast === undefined || sample.riderNorth === undefined) continue
    const { x, y } = tileCoordinates(geoAt(sample.riderEast, sample.riderNorth), MAP_TILE_ZOOM)
    for (let row = Math.floor(y - reach); row <= Math.floor(y + reach); row++) {
      for (let column = Math.floor(x - reach); column <= Math.floor(x + reach); column++) {
        const nearestX = Math.min(Math.max(x, column), column + 1)
        const nearestY = Math.min(Math.max(y, row), row + 1)
        if (Math.hypot(nearestX - x, nearestY - y) <= reach)
          keys.add(`${MAP_TILE_ZOOM}/${column}/${row}`)
      }
    }
  }
  return [...keys].sort()
}

const MAP_TILE_FETCH_TIMEOUT_MS = 30_000

/**
 * Downloads missing tiles from the Static Tiles API, the URL `MapTiles` uses, and drops tiles no
 * longer on the list. The token is read here only and never written anywhere.
 */
async function syncMapTiles(keys: string[]): Promise<void> {
  const token = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN
  const wanted = new Set(keys)
  let downloaded = 0
  for (const key of keys) {
    const file = join(MAP_TILE_DIR, `${key}.jpg`)
    if (existsSync(file)) continue
    if (!token) throw new Error(`map tile ${key} is missing; set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`)
    const url = `https://api.mapbox.com/styles/v1/${MAP_STYLE}/tiles/512/${key}.jpeg?access_token=${token}`
    // A network error carries the request URL, and with it the token: only its name goes out.
    const hideUrl = (error: unknown): never => {
      throw new Error(`map tile ${key}: ${error instanceof Error ? error.name : 'fetch failed'}`)
    }
    const response = await fetch(url, {
      signal: AbortSignal.timeout(MAP_TILE_FETCH_TIMEOUT_MS),
    }).catch(hideUrl)
    if (!response.ok) throw new Error(`map tile ${key}: HTTP ${response.status}`)
    const body = await response.arrayBuffer().catch(hideUrl)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, Buffer.from(body))
    downloaded++
  }
  let bytes = 0
  for (const entry of readdirSync(MAP_TILE_DIR, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = join(entry.parentPath, entry.name)
    const key = file.slice(MAP_TILE_DIR.length + 1).replace(/\.jpg$/, '')
    if (wanted.has(key)) bytes += readFileSync(file).length
    else rmSync(file)
  }
  writeFileSync(
    join(OUT_DIR, 'watch-map-tiles.json'),
    JSON.stringify({ style: MAP_STYLE, tiles: keys }),
  )
  console.log(
    `watch-map-tiles: ${keys.length} z${MAP_TILE_ZOOM} tiles, ${Math.round(bytes / 1024)} KB, ${downloaded} downloaded`,
  )
}

mkdirSync(OUT_DIR, { recursive: true })
const ride = buildRide()
const sweep = buildSweep()
writeFileSync(join(OUT_DIR, 'watch-ride.jsonl'), serialize(ride))
writeFileSync(join(OUT_DIR, 'watch-sweep.jsonl'), serialize(sweep))
writeFileSync(join(OUT_DIR, 'watch-route.json'), JSON.stringify({ origin: ORIGIN, points: ROUTE }))
writeFileSync(join(OUT_DIR, 'watch-weather.json'), JSON.stringify(buildWeather()))
await syncMapTiles(mapTileKeys([ride, sweep]))
console.log(`wrote fixtures to ${OUT_DIR}`)
