import { mkdirSync, readFileSync, writeFileSync } from 'fs'
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
 */

const ROOT = join(import.meta.dir, '..')
const SOURCE = join(ROOT, 'shared', 'fixtures', 'replay-thor301.jsonl')
const OUT_DIR = join(ROOT, 'watch', 'wearos', 'src', 'main', 'assets')

/** Watch tick cadence (`wearMirrorIntervalMs` default), so a replayed lane stream is paced like a real push. */
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

/** Decodes the recorded ride into one telemetry sample per parsed ALLDATA packet. */
function decodeRide(): { t: number; telemetry: Telemetry }[] {
  const reassembler = new PacketReassembler()
  const decoded: { t: number; telemetry: Telemetry }[] = []
  for (const line of readFileSync(SOURCE, 'utf8').split('\n')) {
    if (!line) continue
    let record: { t?: number; kind?: string; direction?: string; base64?: string }
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record.kind !== 'ble-chunk' || record.direction !== 'rx' || !record.base64) continue
    const chunk = Uint8Array.from(Buffer.from(record.base64, 'base64'))
    for (const packet of reassembler.feed(chunk)) {
      const telemetry = parseAllData(packet)
      if (telemetry) decoded.push({ t: record.t ?? 0, telemetry })
    }
  }
  return decoded
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
    samples.push({
      t: t - decoded[0].t,
      speed: round(Math.abs(telemetry.speed)),
      duty: round(Math.abs(telemetry.dutyCycle) * 100),
      battery: round(estimateSoc(telemetry.batteryVoltage, telemetry.batteryCurrent, seriesCount)),
      motorTemp: telemetry.tempMotor === null ? null : round(telemetry.tempMotor),
      ctrlTemp: telemetry.tempMosfet === null ? null : round(telemetry.tempMosfet),
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

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'watch-ride.jsonl'), serialize(buildRide()))
writeFileSync(join(OUT_DIR, 'watch-sweep.jsonl'), serialize(buildSweep()))
console.log(`wrote fixtures to ${OUT_DIR}`)
