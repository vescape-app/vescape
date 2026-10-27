import { defaultMotionConfig, validMotionConfig, type MotionConfig } from './config'

export interface MotionFix {
  longitude: number
  latitude: number
  /** Original measurement clock, used only for ordering/cadence. */
  timestamp: number
  accuracyM: number | null
}
interface Vector {
  x: number
  y: number
}
const zero = (): Vector => ({ x: 0, y: 0 })
const add = (a: Vector, b: Vector): Vector => ({ x: a.x + b.x, y: a.y + b.y })
const scale = (a: Vector, n: number): Vector => ({ x: a.x * n, y: a.y * n })
const dot = (a: Vector, b: Vector) => a.x * b.x + a.y * b.y
const length = (a: Vector) => Math.hypot(a.x, a.y)
interface Direction {
  unit: Vector
  confidence: number
  at: number
}
interface DirectionPoint {
  p: Vector
  at: number
  accuracy: number
}

/** Meaningful points, rather than every jitter sample, form the bounded window. Both callers use
 * the same estimator. A cluster never renews the last direction's evidence timestamp. */
class TravelDirection {
  private points: DirectionPoint[] = []
  private last: Direction | null = null
  reset() {
    this.points = []
    this.last = null
  }
  update(p: Vector, accuracy: number, now: number, window: number, config: MotionConfig) {
    this.points = this.points.filter((point) => now - point.at <= config.directionWindowS * 1000)
    const previous = this.points.at(-1)
    if (!previous) {
      this.points.push({ p, at: now, accuracy })
      return
    }
    const displacement = add(p, scale(previous.p, -1))
    const distance = length(displacement)
    const minimum = Math.max(
      config.movementM,
      Math.max(accuracy, previous.accuracy) * config.accuracyMovementRatio,
    )
    if (distance < minimum) return
    this.points.push({ p, at: now, accuracy })
    this.points = this.points.slice(-window)
    // The newest segment keeps tight turns/reversals responsive; older segments calm the camera.
    const origin = this.points[0]!
    const acrossWindow = add(p, scale(origin.p, -1))
    // A U-turn can cancel a longer window. Its newest meaningful segment is still evidence.
    const direction =
      dot(acrossWindow, displacement) > 0 && length(acrossWindow) >= minimum
        ? acrossWindow
        : displacement
    this.last = {
      unit: scale(direction, 1 / length(direction)),
      confidence: Math.min(1, distance / Math.max(minimum, config.fullConfidenceM)),
      at: now,
    }
  }
  read(now: number, config: MotionConfig): Direction | null {
    return this.last && now - this.last.at < config.directionRetentionS * 1000 ? this.last : null
  }
}

export interface MotionDiagnostics {
  measured: MotionFix | null
  displayed: [number, number] | null
  cadenceMs: number
  confidence: number
  effectivePrediction: number
  directionAgeMs: number | null
  reason: string
  recovering: boolean
}

/** One display owner. Events integrate the OLD velocity first, then change only future motion.
 * Correction has its own deadline. A speed/config update cannot restart it.
 * @parity /watch/wearos/src/main/java/app/vescape/wear/LiveGpsMotion.kt
 * @parity /modules/vescape-core/ios/watch/LiveGpsMotion.swift
 */
export class LiveGpsMotion {
  config: MotionConfig = { ...defaultMotionConfig }
  private origin: MotionFix | null = null
  private fix: MotionFix | null = null
  private p = zero()
  private time = 0
  private correction = zero()
  private correctionEnd = 0
  private speed = 0
  private speedAt = -Infinity
  private speedRevision = -Infinity
  private fixAt = -Infinity
  private source = 0
  private resetRevision = 0
  private resetAt = -Infinity
  private intervals: number[] = []
  private pointDirection = new TravelDirection()
  private cameraDirection = new TravelDirection()
  private heldHeading: number | null = null
  private contradictionAt: number | null = null
  private predictedM = 0
  private recovery = false
  private gpsUsable = true
  cadenceMs = 1000

  reset(source: number, now: number) {
    if (source < this.source) return
    this.source = source
    this.resetRevision++
    this.resetAt = now
    this.time = now
    this.origin = null
    this.fix = null
    this.p = zero()
    this.correction = zero()
    this.correctionEnd = now
    this.speed = 0
    this.speedAt = -Infinity
    this.speedRevision = -Infinity
    this.fixAt = -Infinity
    this.intervals = []
    this.cadenceMs = 1000
    this.pointDirection.reset()
    this.cameraDirection.reset()
    this.heldHeading = null
    this.contradictionAt = null
    this.predictedM = 0
    this.recovery = false
    this.brakingAxis = null
    this.gpsUsable = true
  }
  configure(config: MotionConfig, now: number) {
    this.advance(now)
    this.config = validMotionConfig(config)
  }
  updateSpeed(mps: number | null, revision: number, receivedAt: number, source: number, ageMs = 0) {
    if (source !== this.source || receivedAt < this.resetAt || revision <= this.speedRevision)
      return false
    this.advance(receivedAt)
    this.speedRevision = revision
    this.speed = mps != null && Number.isFinite(mps) ? Math.abs(mps) : 0
    this.speedAt = receivedAt - Math.max(0, ageMs)
    return true
  }
  private acceptsFix(
    fix: MotionFix,
    receivedAt: number,
    ageMs: number,
    source: number,
  ): fix is MotionFix & { accuracyM: number } {
    return !(
      source !== this.source ||
      receivedAt < this.resetAt ||
      !Number.isFinite(fix.timestamp) ||
      !Number.isFinite(fix.longitude) ||
      !Number.isFinite(fix.latitude) ||
      Math.abs(fix.latitude) > 85 ||
      Math.abs(fix.longitude) > 180 ||
      fix.accuracyM == null ||
      !Number.isFinite(fix.accuracyM) ||
      fix.accuracyM < 0 ||
      fix.accuracyM > this.config.maxAccuracyM ||
      !Number.isFinite(ageMs) ||
      ageMs < 0 ||
      ageMs >= this.config.gpsFreshnessS * 1000 ||
      (this.fix && fix.timestamp <= this.fix.timestamp)
    )
  }
  accept(fix: MotionFix, receivedAt: number, ageMs: number, source: number): boolean {
    if (
      source === this.source &&
      receivedAt >= this.resetAt &&
      (!this.fix || fix.timestamp > this.fix.timestamp) &&
      (fix.accuracyM == null ||
        !Number.isFinite(fix.accuracyM) ||
        fix.accuracyM > this.config.maxAccuracyM)
    ) {
      this.advance(receivedAt)
      this.gpsUsable = false
    }
    if (!this.acceptsFix(fix, receivedAt, ageMs, source)) return false
    this.advance(receivedAt)
    const previous = this.fix
    const interval = previous ? fix.timestamp - previous.timestamp : 0
    const gap = previous != null && interval > this.config.gpsFreshnessS * 1000
    if (interval > 0 && !gap) {
      this.intervals.push(interval)
      this.intervals = this.intervals.slice(-5)
      const sorted = [...this.intervals].sort((a, b) => a - b)
      this.cadenceMs = Math.max(100, Math.min(3000, sorted[Math.floor(sorted.length / 2)]!))
    }
    if (gap) {
      this.pointDirection.reset()
      this.cameraDirection.reset()
      this.intervals = []
      this.brakingAxis = null
      this.contradictionAt = null
      this.cadenceMs = 1000
    }
    if (!this.origin) {
      this.origin = fix
      this.p = zero()
    }
    const measured = this.toMeters(fix)
    this.fix = fix
    this.gpsUsable = true
    this.fixAt = receivedAt - ageMs
    this.predictedM = 0
    this.pointDirection.update(
      measured,
      fix.accuracyM,
      this.fixAt,
      this.config.pointWindow,
      this.config,
    )
    this.cameraDirection.update(
      measured,
      fix.accuracyM,
      this.fixAt,
      this.config.cameraWindow,
      this.config,
    )
    const direction = this.pointDirection.read(receivedAt, this.config)
    if (direction) this.brakingAxis = direction.unit
    const error = add(measured, scale(this.p, -1))
    const axis = direction?.unit ?? this.brakingAxis
    const behind = axis && dot(error, axis) < -0.25 && fix.accuracyM <= this.config.goodAccuracyM
    if (behind) this.contradictionAt ??= receivedAt
    else this.contradictionAt = null
    // Stationary reliable fixes also need bounded recovery after the retained direction expires.
    this.recovery =
      this.contradictionAt != null &&
      receivedAt - this.contradictionAt >= this.config.recoveryAfterS * 1000
    this.correction = scale(error, 1000 / this.cadenceMs)
    if (this.recovery && length(this.correction) > this.config.recoverySpeedMps) {
      this.correction = scale(
        this.correction,
        this.config.recoverySpeedMps / length(this.correction),
      )
    }
    this.correctionEnd =
      receivedAt +
      (this.recovery
        ? Math.max(this.cadenceMs, (length(error) / this.config.recoverySpeedMps) * 1000)
        : this.cadenceMs)
    if (!previous) {
      this.p = measured
      this.correction = zero()
    }
    return true
  }
  private toMeters(fix: MotionFix): Vector {
    const origin = this.origin!
    return {
      x:
        (((fix.longitude - origin.longitude + 540) % 360) - 180) *
        111320 *
        Math.cos((origin.latitude * Math.PI) / 180),
      y: (fix.latitude - origin.latitude) * 110574,
    }
  }
  private coordinate(p: Vector): [number, number] | null {
    if (!this.origin) return null
    return [
      ((this.origin.longitude +
        p.x / (111320 * Math.cos((this.origin.latitude * Math.PI) / 180)) +
        540) %
        360) -
        180,
      this.origin.latitude + p.y / 110574,
    ]
  }
  private prediction(now: number, predictedM = this.predictedM) {
    const direction = this.pointDirection.read(now, this.config)
    const accuracy = this.fix?.accuracyM ?? Infinity
    const quality = Math.max(
      0,
      Math.min(
        1,
        (this.config.maxAccuracyM - accuracy) /
          (this.config.maxAccuracyM - this.config.goodAccuracyM),
      ),
    )
    const deadline = Math.min(
      this.fixAt + Math.min(this.config.gpsFreshnessS, this.config.predictionHorizonS) * 1000,
      this.speedAt + this.config.telemetryFreshnessS * 1000,
      (direction?.at ?? -Infinity) + this.config.directionRetentionS * 1000,
    )
    const confidence = quality * (direction?.confidence ?? 0)
    const enabled =
      now < deadline &&
      predictedM < this.config.maxPredictionM - 1e-9 &&
      !this.recovery &&
      this.gpsUsable
    return {
      direction,
      confidence,
      deadline,
      velocity:
        enabled && direction
          ? scale(direction.unit, this.speed * this.config.predictionStrength * confidence)
          : zero(),
    }
  }
  /** Next constant-velocity boundary; the point adapter sends one native move, never frame samples. */
  segment(now: number) {
    this.advance(now)
    const prediction = this.prediction(now)
    let end = Math.min(
      this.correctionEnd > now ? this.correctionEnd : Infinity,
      length(prediction.velocity) > 0 ? prediction.deadline : Infinity,
    )
    if (length(prediction.velocity) > 0)
      end = Math.min(
        end,
        now + ((this.config.maxPredictionM - this.predictedM) / length(prediction.velocity)) * 1000,
      )
    if (!Number.isFinite(end)) end = now
    return {
      revision: this.resetRevision,
      from: this.coordinate(this.p),
      to: this.coordinate(this.project(end).p),
      durationMs: Math.max(0, end - now),
    }
  }
  private project(now: number) {
    let p = this.p
    let at = this.time
    let predicted = this.predictedM
    while (at < now) {
      const prediction = this.prediction(at, predicted)
      const pv = prediction.velocity
      const predictionEnd =
        length(pv) > 0
          ? Math.min(
              prediction.deadline,
              at + ((this.config.maxPredictionM - predicted) / length(pv)) * 1000,
            )
          : Infinity
      const end = Math.min(
        now,
        this.correctionEnd > at ? this.correctionEnd : Infinity,
        predictionEnd,
      )
      let velocity = add(at < this.correctionEnd ? this.correction : zero(), pv)
      // A behind fix consumes forward velocity instead of pulling back during ordinary braking.
      // Keep the last evidenced axis even when prediction freshness expires.
      const axis = this.brakingAxis
      if (!this.recovery && axis && dot(velocity, axis) < 0)
        velocity = add(velocity, scale(axis, -dot(velocity, axis)))
      const dt = (end - at) / 1000
      p = add(p, scale(velocity, dt))
      predicted += length(pv) * dt
      if (end <= at) break
      at = end
    }
    return { p, predicted }
  }
  private brakingAxis: Vector | null = null
  private advance(now: number) {
    if (now <= this.time) return
    const direction = this.pointDirection.read(this.time, this.config)
    if (direction) this.brakingAxis = direction.unit
    const next = this.project(now)
    this.p = next.p
    this.predictedM = next.predicted
    this.time = now
  }
  position(now: number) {
    return this.coordinate(this.project(Math.max(now, this.time)).p)
  }
  cameraHeading(now: number): number | null {
    const direction = this.cameraDirection.read(now, this.config)
    if (direction)
      this.heldHeading =
        ((Math.atan2(direction.unit.x, direction.unit.y) * 180) / Math.PI + 360) % 360
    return this.heldHeading
  }
  pointHeading(now: number): number | null {
    const direction = this.pointDirection.read(now, this.config)
    return direction
      ? ((Math.atan2(direction.unit.x, direction.unit.y) * 180) / Math.PI + 360) % 360
      : null
  }
  diagnostics(now: number): MotionDiagnostics {
    const prediction = this.prediction(now)
    return {
      measured: this.fix,
      displayed: this.position(now),
      cadenceMs: this.cadenceMs,
      confidence: prediction.confidence,
      effectivePrediction: length(prediction.velocity) / (this.speed || 1),
      directionAgeMs: prediction.direction ? now - prediction.direction.at : null,
      recovering: this.recovery,
      reason: !this.gpsUsable
        ? 'gps-unusable'
        : this.recovery
          ? 'persistent-overshoot-recovery'
          : !prediction.direction
            ? 'direction-unavailable'
            : now >= prediction.deadline
              ? 'input-expired'
              : this.speed === 0
                ? 'board-stopped-or-missing'
                : 'predicting',
    }
  }
}
