import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Derives `replay-thor301-1hz.jsonl`, the smoke replay, from the full-rate Thor301 recording.
 *
 * At its recorded ~15 Hz telemetry and ~10 Hz phone heading, the replay keeps the app busy enough
 * that every Maestro hierarchy read on a CPU-rendered CI emulator stalls; the battery alert flow
 * outran its 15-minute step limit. Smoke checks that screens work, not pipeline throughput, so it
 * replays one Refloat realtime frame and one heading per second. Every other rx packet, location
 * fix and session state is kept as recorded. `tx` chunks are dropped: replay swallows writes.
 *
 * Run: `bun run scripts/thin-replay-fixture.ts`
 */

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
  // Short frames carry a 1-byte length after the 0x02 start byte, long frames a 2-byte one.
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

writeFileSync(TARGET, `${kept.join('\n')}\n`)
console.log(`${kept.length} of ${lines.length} events → ${TARGET}`)
