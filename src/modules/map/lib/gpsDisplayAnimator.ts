import type { GpsDisplayMotion } from 'vescape-core'
import { gpsDisplayPosition } from './gpsDisplayMotion'

interface PointAnimator {
  moveTo(args: { coordinate: [number, number]; durationMs: number }): void
  setMotion(motion: GpsDisplayMotion): unknown
}

/** The native renderer runs GPS correction and VESC velocity independently of JS frame cadence. */
export class GpsDisplayAnimatorController {
  private initialized = false
  constructor(private readonly animator: PointAnimator) {}

  update(motion: GpsDisplayMotion | null | undefined, active: boolean, now: number) {
    if (!motion) {
      this.initialized = false
      return
    }
    if (!active) {
      this.animator.moveTo({ coordinate: gpsDisplayPosition(motion, now), durationMs: 0 })
      this.initialized = false
      return
    }
    this.animator.setMotion({ ...motion, resetPosition: !this.initialized || motion.resetPosition })
    this.initialized = true
  }
}
