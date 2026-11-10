/**
 * Spike #662: render one 512 px raster tile from OpenFreeMap vector tiles with MapLibre Native
 * (what a server-side renderer would do) next to the Mapbox Static Tiles original that `MapTiles`
 * downloads today, and time the renders.
 *
 *   bun run scripts/spike/render-tile.ts [z x y] [--out /tmp/spike/tiles]
 *
 * MapLibre Native's Node addon is NAN-based and has no Bun build, so the render step re-runs this
 * file under Node 22 (`--experimental-strip-types`). Install the renderer outside the repo:
 *   mkdir /tmp/spike/render && cd /tmp/spike/render && bun add @maplibre/maplibre-gl-native
 *   (then place the node-v127 darwin/linux prebuilt from the maplibre-native GitHub release in lib/)
 * and point RENDERER_DIR at it. NODE22 overrides the node binary path.
 *
 * Style: OpenFreeMap "dark" stands in for One Dark until #656 ports it to OpenMapTiles.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const OUT = outIndex >= 0 ? args[outIndex + 1]! : '/tmp/spike/tiles'
const positional = args
  .filter((a, i) => !a.startsWith('--') && (outIndex < 0 || i !== outIndex + 1))
  .map(Number)
const [z, x, y] = positional.length === 3 ? positional : [14, 8967, 5478]
const MAPBOX_STYLE = 'kacperkozak/cmux9d4th002j01s4fm7tc4mt' // MapTiles.STYLE
const OPEN_STYLE = 'https://tiles.openfreemap.org/styles/dark'
const RENDERER_DIR = process.env.RENDERER_DIR ?? '/tmp/spike/render'
const NODE22 = process.env.NODE22 ?? '/opt/homebrew/opt/node@22/bin/node'
const USER_AGENT = 'vescape-spike/0.1'

function tileCenter(tz: number, tx: number, ty: number) {
  const n = 2 ** tz
  const lon = ((tx + 0.5) / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + 0.5)) / n))) * 180) / Math.PI
  return [lon, lat] as [number, number]
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

async function renderUnderNode() {
  const require = createRequire(join(RENDERER_DIR, 'package.json'))
  const mbgl = require('@maplibre/maplibre-gl-native')
  let requests = 0
  const map = new mbgl.Map({
    ratio: 1,
    request(
      req: { url: string },
      callback: (error?: Error | null, response?: { data: Buffer }) => void,
    ) {
      requests++
      fetch(req.url, { headers: { 'User-Agent': USER_AGENT } })
        .then(async (res) =>
          res.ok
            ? callback(null, { data: Buffer.from(await res.arrayBuffer()) })
            : callback(
                res.status === 404 ? null : new Error(`HTTP ${res.status}`),
                res.status === 404 ? { data: Buffer.alloc(0) } : undefined,
              ),
        )
        .catch((error: Error) => callback(error))
    },
  })
  const style = await (await fetch(OPEN_STYLE, { headers: { 'User-Agent': USER_AGENT } })).json()
  map.load(style)
  const render = (tz: number, tx: number, ty: number) =>
    new Promise<Uint8Array>((resolve, reject) =>
      map.render(
        { zoom: tz, center: tileCenter(tz, tx, ty), width: 512, height: 512 },
        (error: Error | null, pixels: Uint8Array) => (error ? reject(error) : resolve(pixels)),
      ),
    )
  const timings: number[] = []
  // First render is cold (style, sprites, glyphs, vector tiles); the next four are neighbours.
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const) {
    const started = performance.now()
    const pixels = await render(z, x + dx, y + dy)
    timings.push(Math.round(performance.now() - started))
    if (dx === 0 && dy === 0)
      writeFileSync(join(OUT, `maplibre-${z}-${x}-${y}.png`), png(pixels, 512, 512))
  }
  map.release()
  console.log(
    `maplibre native render ms: cold ${timings[0]}, warm ${timings.slice(1).join(', ')}; upstream requests ${requests}`,
  )
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  if (!process.versions.bun) return renderUnderNode()

  const { readEnv } = await import('./spikeEnv')
  const token = readEnv('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN')
  if (!token) throw new Error('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN not found')
  const started = performance.now()
  const res = await fetch(
    `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/tiles/512/${z}/${x}/${y}.jpeg?access_token=${token}`,
  )
  if (!res.ok) throw new Error(`Mapbox tile HTTP ${res.status}`)
  const jpeg = Buffer.from(await res.arrayBuffer())
  writeFileSync(join(OUT, `mapbox-${z}-${x}-${y}.jpg`), jpeg)
  console.log(
    `mapbox static tile ${z}/${x}/${y}: ${jpeg.length} bytes, ${Math.round(performance.now() - started)} ms`,
  )

  const child = Bun.spawnSync(
    [
      NODE22,
      '--experimental-strip-types',
      '--no-warnings',
      import.meta.path,
      String(z),
      String(x),
      String(y),
      '--out',
      OUT,
    ],
    {
      env: { ...process.env, EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: '', MAPBOX_SECRET_TOKEN: '' },
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )
  if (child.exitCode !== 0) process.exit(child.exitCode ?? 1)
  console.log(`written to ${OUT}`)
}

await main()
