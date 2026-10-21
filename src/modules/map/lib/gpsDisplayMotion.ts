import type { GpsDisplayMotion } from 'vescape-core'

/** Evaluate independent GPS correction and bounded VESC dead reckoning after transport.
 * @parity /modules/vescape-core/ios/location/GpsDisplaySmoother.swift `position`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsDisplaySmoother.kt `positionAt`
 */
export function gpsDisplayPosition(motion: GpsDisplayMotion, nowMs: number): [number, number] {
  const duration = motion.endsAtMs - motion.startsAtMs
  const t = duration > 0 ? Math.min(1, Math.max(0, (nowMs - motion.startsAtMs) / duration)) : 1
  const elapsed = Math.max(0, Math.min(nowMs, motion.velocityExpiresAtMs ?? 0) - motion.startsAtMs)
  const longitudeDelta = ((motion.toLongitude - motion.fromLongitude + 540) % 360) - 180
  return [
    ((motion.fromLongitude + longitudeDelta * t + (motion.longitudePerMs ?? 0) * elapsed + 540) %
      360) -
      180,
    motion.fromLatitude +
      (motion.toLatitude - motion.fromLatitude) * t +
      (motion.latitudePerMs ?? 0) * elapsed,
  ]
}
