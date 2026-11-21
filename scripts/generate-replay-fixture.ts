import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..')

const DURATION_MS = 120_000
const FRAME_INTERVAL_MS = 250
const CELL_COUNT = 16
const CHUNK_SIZE = 20
const COMM_BMS_GET_VALUES = 96

let seed = 20260719
function random(): number {
  seed = (seed * 48271) % 2147483647
  return seed / 2147483647
}

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

function frame(payload: Uint8Array): Uint8Array {
  const framed = new Uint8Array(2 + payload.length + 3)
  framed[0] = 0x02
  framed[1] = payload.length
  framed.set(payload, 2)
  const crc = crc16(payload)
  framed[2 + payload.length] = (crc >> 8) & 0xff
  framed[3 + payload.length] = crc & 0xff
  framed[4 + payload.length] = 0x03
  return framed
}

class PayloadWriter {
  readonly bytes: number[] = []

  u8(value: number) {
    this.bytes.push(value & 0xff)
  }

  i16(value: number) {
    const v = Math.round(value) & 0xffff
    this.bytes.push((v >> 8) & 0xff, v & 0xff)
  }

  i32(value: number) {
    const v = Math.round(value) | 0
    this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
  }
}

function bmsPayload(cellVoltages: number[], current: number, ampHours: number): Uint8Array {
  const writer = new PayloadWriter()
  const totalV = cellVoltages.reduce((sum, v) => sum + v, 0)
  writer.u8(COMM_BMS_GET_VALUES)
  writer.i32(totalV * 1e6)
  writer.i32(0)
  writer.i32(current * 1e6)
  writer.i32(current * 1e6)
  writer.i32(ampHours * 1e3)
  writer.i32(ampHours * totalV * 1e3)
  writer.u8(cellVoltages.length)
  for (const v of cellVoltages) writer.i16(v * 1e3)
  for (const _ of cellVoltages) writer.u8(0)
  writer.u8(2)
  writer.i16(24.5 * 1e2)
  writer.i16(25.1 * 1e2)
  writer.i16(26.0 * 1e2)
  writer.i16(24.0 * 1e2)
  writer.i16(41.0 * 1e2)
  writer.i16(25.4 * 1e2)
  writer.u8(Math.round(0.82 * 255))
  writer.u8(Math.round(0.97 * 255))
  writer.u8(10)
  return Uint8Array.from(writer.bytes)
}

function line(fields: Record<string, unknown>): string {
  return JSON.stringify(fields)
}

function chunkLines(t: number, direction: 'rx' | 'tx', framed: Uint8Array): string[] {
  const lines: string[] = []
  for (let offset = 0; offset < framed.length; offset += CHUNK_SIZE) {
    const chunk = framed.slice(offset, offset + CHUNK_SIZE)
    lines.push(
      line({ t, kind: 'ble-chunk', direction, base64: Buffer.from(chunk).toString('base64') }),
    )
  }
  return lines
}

const lines: string[] = [
  line({
    t: 0,
    kind: 'meta',
    version: 1,
    deviceName: 'Replay Fixture Board',
    deviceId: 'replay-fixture',
    sessionKind: 'board',
    pollIntervalMs: FRAME_INTERVAL_MS,
    startedAt: 1752900000000,
  }),
  line({ t: 0, kind: 'session-state', status: 'recording-started' }),
]

const cellOffsets = Array.from({ length: CELL_COUNT }, () => (random() - 0.5) * 0.02)
let ampHours = 0.4

for (let t = FRAME_INTERVAL_MS; t <= DURATION_MS; t += FRAME_INTERVAL_MS) {
  const baseV = 3.92 - 0.04 * (t / DURATION_MS)
  const cells = cellOffsets.map((offset) => baseV + offset + (random() - 0.5) * 0.008)
  const current = -(4 + random() * 10)
  ampHours += (-current * FRAME_INTERVAL_MS) / 3_600_000
  lines.push(...chunkLines(t, 'rx', frame(bmsPayload(cells, current, ampHours))))

  if (t % 5_000 === 0) {
    lines.push(...chunkLines(t, 'tx', frame(Uint8Array.from([COMM_BMS_GET_VALUES]))))
    lines.push(
      line({
        t,
        kind: 'location',
        latitude: 52.4 + t / 1e8,
        longitude: 16.9 + t / 1e8,
        speedMps: 6.5,
        bearingDeg: 90,
        accuracyM: 4,
        altitudeM: 80,
        timestamp: 1752900000000 + t,
      }),
    )
  }
}

lines.push('{"t":119900,"kind":"ble-chu')
lines.push(line({ t: DURATION_MS, kind: 'session-state', status: 'disconnected' }))

const dir = join(ROOT, 'shared', 'fixtures')
mkdirSync(dir, { recursive: true })
const file = join(dir, 'replay-synthetic-bms.jsonl')
writeFileSync(file, lines.join('\n') + '\n')
console.log(`✓ ${file} (${lines.length} lines)`)
