/**
 * Spike #656: render One Dark (OpenMapTiles, OpenFreeMap tiles) next to the Mapbox One Dark at a
 * few places, for side-by-side comparison. Per place it writes three 512 px images:
 *   <place>-omt.png            ported style, MapLibre Native, OpenFreeMap tiles
 *   <place>-mapbox.png         Mapbox One Dark style JSON, MapLibre Native, mapbox-streets-v8 tiles
 *   <place>-mapbox-static.jpg  the hosted thumbnail style (ground layers only) via Static Tiles
 *
 *   bun run scripts/spike/render-style.ts [--out /tmp/spike/style]
 *
 * The render half runs under Node 22 like render-tile.ts (same RENDERER_DIR / NODE22 setup). The
 * Mapbox token stays in memory: it is passed to the child through the environment and never logged.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const OUT = outIndex >= 0 ? args[outIndex + 1]! : '/tmp/spike/style'
const RENDERER_DIR = process.env.RENDERER_DIR ?? '/tmp/spike/render'
const NODE22 = process.env.NODE22 ?? '/opt/homebrew/opt/node@22/bin/node'
const MAPBOX_STATIC_STYLE = 'kacperkozak/cmux9d4th002j01s4fm7tc4mt' // MapTiles.STYLE
const USER_AGENT = 'vescape-spike/0.1'

/** Wrocław and Poland. Centres snap to the tile centre so the static tile covers the same view. */
const PLACES = [
  { name: 'city-z16', lat: 51.11, lon: 17.032, z: 16 },
  { name: 'city-z15', lat: 51.11, lon: 17.032, z: 15 },
  { name: 'suburb-z14', lat: 51.075, lon: 17.005, z: 14 },
  { name: 'park-z15', lat: 51.112, lon: 17.078, z: 15 },
  { name: 'region-z9', lat: 51.11, lon: 17.03, z: 9 },
  { name: 'country-z6', lat: 51.9, lon: 19.1, z: 6 },
]

function tileOf(lat: number, lon: number, z: number) {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const rad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)
  return { x, y }
}

function tileCenter(z: number, x: number, y: number): [number, number] {
  const n = 2 ** z
  const lon = ((x + 0.5) / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI
  return [lon, lat]
}

function crc32(buf: Buffer) {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function png(rgba: Uint8Array, width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let row = 0; row < height; row++)
    Buffer.from(rgba.buffer, rgba.byteOffset + row * width * 4, width * 4).copy(
      raw,
      row * (width * 4 + 1) + 1,
    )
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** mapbox:// → https with the token appended; only ever used inside the request callback. */
function resolveMapboxUrl(url: string, token: string) {
  let resolved = url
  if (url.startsWith('mapbox://fonts/'))
    resolved = url.replace('mapbox://fonts/', 'https://api.mapbox.com/fonts/v1/')
  else if (url.startsWith('mapbox://sprites/'))
    resolved = url.replace(
      /^mapbox:\/\/sprites\/([^/]+)\/([^@.]+)(.*)$/,
      'https://api.mapbox.com/styles/v1/$1/$2/sprite$3',
    )
  else if (url.startsWith('mapbox://'))
    resolved = `https://api.mapbox.com/v4/${url.slice('mapbox://'.length)}.json?secure`
  if (!resolved.startsWith('https://api.mapbox.com/') || resolved.includes('access_token='))
    return resolved
  return `${resolved}${resolved.includes('?') ? '&' : '?'}access_token=${token}`
}

async function renderUnderNode() {
  const require = createRequire(join(RENDERER_DIR, 'package.json'))
  const mbgl = require('@maplibre/maplibre-gl-native')
  const token = process.env.SPIKE_MAPBOX_TOKEN ?? ''
  const failures = new Set<string>()
  const makeMap = () =>
    new mbgl.Map({
      ratio: 1,
      request(
        req: { url: string },
        callback: (error?: Error | null, response?: { data: Buffer }) => void,
      ) {
        fetch(resolveMapboxUrl(req.url, token), { headers: { 'User-Agent': USER_AGENT } })
          .then(async (res) => {
            if (res.ok) return callback(null, { data: Buffer.from(await res.arrayBuffer()) })
            if (res.status !== 404) failures.add(`HTTP ${res.status} ${req.url.split('?')[0]}`)
            callback(null, { data: Buffer.alloc(0) })
          })
          .catch((error: Error) => callback(error))
      },
    })
  const places = JSON.parse(readFileSync(join(OUT, 'places.json'), 'utf8')) as {
    name: string
    z: number
    center: [number, number]
  }[]
  const readStyle = (file: string) => JSON.parse(readFileSync(join(OUT, file), 'utf8'))
  const omt = readStyle('one-dark-omt.json')
  // The Mapbox style JSON has no extrusion (the app adds it), so compare flat; 3D gets its own run.
  const omtFlat = {
    ...omt,
    layers: omt.layers.filter((layer: { type: string }) => layer.type !== 'fill-extrusion'),
  }
  for (const [suffix, style, pitch] of [
    ['omt', omtFlat, 0],
    ['omt-3d', omt, 50],
    ['mapbox', readStyle('one-dark-mapbox.json'), 0],
  ] as const) {
    const map = makeMap()
    map.load(style)
    for (const place of places) {
      const pixels = await new Promise<Uint8Array>((resolve, reject) =>
        map.render(
          { zoom: place.z, center: place.center, pitch, width: 512, height: 512 },
          (error: Error | null, data: Uint8Array) => (error ? reject(error) : resolve(data)),
        ),
      )
      writeFileSync(join(OUT, `${place.name}-${suffix}.png`), png(pixels, 512, 512))
    }
    map.release()
  }
  for (const failure of failures) console.log(failure)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  if (!process.versions.bun) return renderUnderNode()

  // The style modules import theme.ts, which imports react-native; stub it for a plain Bun run.
  Bun.plugin({
    name: 'react-native-stub',
    setup(build) {
      build.module('react-native', () => ({
        exports: { Platform: { OS: 'web' } }, // adaptive colours resolve to their dark value
        loader: 'object',
      }))
    },
  })
  const { ONE_DARK_OPENMAPTILES_STYLE } =
    await import('../../src/modules/map/constants/oneDarkOpenMapTilesStyle')
  const { ONE_DARK_MAP_STYLE } = await import('../../src/modules/map/constants/oneDarkMapStyle')
  writeFileSync(
    join(OUT, 'one-dark-omt.json'),
    JSON.stringify(ONE_DARK_OPENMAPTILES_STYLE, null, 1),
  )
  writeFileSync(join(OUT, 'one-dark-mapbox.json'), ONE_DARK_MAP_STYLE)

  const { readEnv } = await import('./spikeEnv')
  const token = readEnv('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN')
  if (!token) throw new Error('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN not found')

  const places = PLACES.map((place) => {
    const { x, y } = tileOf(place.lat, place.lon, place.z)
    return { name: place.name, z: place.z, x, y, center: tileCenter(place.z, x, y) }
  })
  writeFileSync(join(OUT, 'places.json'), JSON.stringify(places))
  for (const place of places) {
    const res = await fetch(
      `https://api.mapbox.com/styles/v1/${MAPBOX_STATIC_STYLE}/tiles/512/${place.z}/${place.x}/${place.y}.jpeg?access_token=${token}`,
    )
    if (!res.ok) throw new Error(`Mapbox static tile HTTP ${res.status}`)
    writeFileSync(
      join(OUT, `${place.name}-mapbox-static.jpg`),
      Buffer.from(await res.arrayBuffer()),
    )
  }

  const child = Bun.spawnSync(
    [NODE22, '--experimental-strip-types', '--no-warnings', import.meta.path, '--out', OUT],
    {
      env: {
        ...process.env,
        SPIKE_MAPBOX_TOKEN: token,
        EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: '',
        MAPBOX_SECRET_TOKEN: '',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const { redact } = await import('./spikeEnv')
  process.stdout.write(redact(child.stdout.toString()))
  process.stderr.write(redact(child.stderr.toString()))
  if (child.exitCode !== 0) process.exit(child.exitCode ?? 1)
  console.log(`written to ${OUT}`)
}

await main()
