import type { GpsDisplayMotion } from 'vescape-core'
import { gpsDisplayPosition } from './gpsDisplayMotion'

export const DISPLAY_TRAIL_SAMPLE_MS = 50
const RETENTION_MS = 5 * 60_000
const MAX_POINTS = RETENTION_MS / DISPLAY_TRAIL_SAMPLE_MS

interface Sample {
  at: number
  coordinate: [number, number]
  segment: number
}

/** Diagnostic history of evaluated display positions, never measured GPS or persisted Ride Track. */
export class GpsDisplayTrail {
  private samples: Sample[] = []
  private segment = 0
  private lastSampleAt: number | null = null
  private lastMotion: GpsDisplayMotion | null = null

  pause() {
    this.lastSampleAt = null
    this.lastMotion = null
    this.segment++
  }

  sample(motion: GpsDisplayMotion | null, now: number) {
    this.samples = this.samples.filter((sample) => now - sample.at <= RETENTION_MS)
    if (!motion) {
      this.pause()
      return
    }
    if (
      (this.lastSampleAt !== null &&
        (now < this.lastSampleAt || now - this.lastSampleAt > 1_000)) ||
      (motion !== this.lastMotion && motion.resetPosition)
    )
      this.segment++
    this.lastSampleAt = now
    this.lastMotion = motion
    const coordinate = gpsDisplayPosition(motion, now)
    if (!coordinate.every(Number.isFinite)) {
      this.pause()
      return
    }
    const last = this.samples.at(-1)
    if (
      last?.segment === this.segment &&
      last.coordinate[0] === coordinate[0] &&
      last.coordinate[1] === coordinate[1]
    )
      return
    this.samples.push({ at: now, coordinate, segment: this.segment })
    if (this.samples.length > MAX_POINTS) this.samples.splice(0, this.samples.length - MAX_POINTS)
  }

  shape(): GeoJSON.Feature<GeoJSON.MultiLineString> | null {
    const lines: [number, number][][] = []
    let segment: number | null = null
    for (const sample of this.samples) {
      if (sample.segment !== segment) {
        lines.push([])
        segment = sample.segment
      }
      lines.at(-1)!.push([...sample.coordinate])
    }
    const coordinates = lines.filter((line) => line.length >= 2)
    return coordinates.length
      ? {
          type: 'Feature',
          properties: {},
          geometry: { type: 'MultiLineString', coordinates },
        }
      : null
  }
}
