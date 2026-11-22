import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const FIXTURES = join(import.meta.dir, '..', 'shared', 'fixtures')
const SOURCE = join(FIXTURES, 'replay-thor301.jsonl')
const TARGET = join(FIXTURES, 'replay-thor301-1hz.jsonl')
const INTERVAL_MS = 1000

const COMM_CUSTOM_APP_DATA = 0x24
const REFLOAT_MAGIC = 0x65
const REFLOAT_REALTIME = 0x0a

interface ReplayEvent {
  t: number
  kind: string
  direction?: 'rx' | 'tx'
  base64?: string
}

function isRealtimeFrame(base64: string): boolean {
  const packet = Buffer.from(base64, 'base64')
  const payload =
    packet[0] === 0x02 ? packet.subarray(2) : packet[0] === 0x03 ? packet.subarray(3) : null
  return (
    payload !== null &&
    payload[0] === COMM_CUSTOM_APP_DATA &&
    payload[1] === REFLOAT_MAGIC &&
    payload[2] === REFLOAT_REALTIME
  )
}

const lastKept = { realtime: -Infinity, heading: -Infinity }
function keepOncePerInterval(key: keyof typeof lastKept, t: number): boolean {
  if (t - lastKept[key] < INTERVAL_MS) return false
  lastKept[key] = t
  return true
}

const lines = readFileSync(SOURCE, 'utf8').split('\n').filter(Boolean)
const kept = lines.filter((line) => {
  const event = JSON.parse(line) as ReplayEvent
  if (event.kind === 'phone-heading') return keepOncePerInterval('heading', event.t)
  if (event.kind !== 'ble-chunk') return true
  if (event.direction === 'tx') return false
  return !isRealtimeFrame(event.base64!) || keepOncePerInterval('realtime', event.t)
})

const events = kept.map((line) => JSON.parse(line) as ReplayEvent)
const duration = Math.max(...events.map((event) => event.t)) + INTERVAL_MS
const playback = events.filter(
  (event) =>
    event.kind === 'ble-chunk' || event.kind === 'location' || event.kind === 'phone-heading',
)
const extended = [...kept]
for (let offset = duration; offset < 60 * 60_000; offset += duration) {
  extended.push(...playback.map((event) => JSON.stringify({ ...event, t: event.t + offset })))
}
writeFileSync(TARGET, `${extended.join('\n')}\n`)
console.log(
  `${kept.length} of ${lines.length} source events, ${extended.length} extended events → ${TARGET}`,
)
