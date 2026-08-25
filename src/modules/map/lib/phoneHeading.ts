/**
 * 30 Hz, not the display rate. The camera spring interpolates between targets, so the sensor only
 * has to keep the target fresh: even a 200 deg/s turn moves under 7 degrees between samples, and
 * the spring covers the gap. Sampling at 60 Hz bought nothing and doubled the per-sample work.
 */
const PHONE_HEADING_INTERVAL_MS = 33
/**
 * Scaled with the alpha above: each sample now carries twice the correction, so holding the old
 * band would have let hand jitter through at the same degrees per second it used to be rejected at.
 */
const PHONE_HEADING_DEAD_BAND_DEG = 0.3
/**
 * Smoothing is applied per sample, so these are tied to the interval above: halving the rate
 * without raising alpha would double the time constant and make the compass visibly lag. Each is
 * the two-sample equivalent of the 60 Hz value it replaces — `1 - (1 - alpha)²` — which leaves the
 * response in wall-clock time where it was.
 */
const PHONE_HEADING_MIN_SMOOTHING_ALPHA = 0.0784
const PHONE_HEADING_MAX_SMOOTHING_ALPHA = 0.2604
const PHONE_HEADING_FULL_SPEED_DELTA_DEG = 90
/** Per-sample cap, likewise doubled so the maximum slew rate in degrees per second is unchanged. */
const PHONE_HEADING_MAX_STEP_DEG = 12

export interface DeviceMotionMeasurement {
  rotation: { alpha: number; beta: number; gamma: number; timestamp: number }
  orientation: number
}

interface PermissionResponse {
  status: string
}

interface Subscription {
  remove: () => void
}

export interface PhoneHeadingAdapter {
  /**
   * Degrees to add to `-rotation.alpha` so the result is the bearing of the phone's top edge.
   *
   * `rotation.alpha` does not mean the same thing on both platforms, and the difference is a
   * property of the sensor source, not of the math — so each adapter states its own origin and the
   * pure heading code stays platform-free.
   */
  headingOffsetDeg: number
  isAvailableAsync: () => Promise<boolean>
  getPermissionsAsync: () => Promise<PermissionResponse>
  requestPermissionsAsync: () => Promise<PermissionResponse>
  setUpdateInterval: (intervalMs: number) => void
  addListener: (listener: (event: DeviceMotionMeasurement) => void) => Subscription
}

export type PhoneHeadingStatus = 'ready' | 'unavailable' | 'denied'

export interface PhoneHeadingSubscription {
  status: PhoneHeadingStatus
  remove: () => void
}

function normalizeHeading(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

export function headingDeltaDeg(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function phoneHeadingFromDeviceMotion(
  event: DeviceMotionMeasurement,
  headingOffsetDeg = 0,
): number | null {
  const alpha = event.rotation?.alpha
  if (typeof alpha !== 'number' || !Number.isFinite(alpha)) return null
  return normalizeHeading((-alpha * 180) / Math.PI + event.orientation + headingOffsetDeg)
}

export function smoothPhoneHeading(
  previous: number | null,
  next: number,
  responseScale = 1,
): number {
  if (previous == null) return normalizeHeading(next)
  const delta = headingDeltaDeg(previous, next)
  const speedRatio = clamp(Math.abs(delta) / PHONE_HEADING_FULL_SPEED_DELTA_DEG, 0, 1)
  const alpha =
    PHONE_HEADING_MIN_SMOOTHING_ALPHA +
    (PHONE_HEADING_MAX_SMOOTHING_ALPHA - PHONE_HEADING_MIN_SMOOTHING_ALPHA) * speedRatio
  const step = clamp(
    delta * alpha * responseScale,
    -PHONE_HEADING_MAX_STEP_DEG * responseScale,
    PHONE_HEADING_MAX_STEP_DEG * responseScale,
  )
  return normalizeHeading(previous + step)
}

export function deadBandPhoneHeading(previous: number | null, next: number): number {
  const smoothed = smoothPhoneHeading(previous, next)
  if (
    previous != null &&
    Math.abs(headingDeltaDeg(previous, smoothed)) < PHONE_HEADING_DEAD_BAND_DEG
  ) {
    return previous
  }
  return smoothed
}

export function phoneHeadingUpdateIntervalMs(): number {
  return PHONE_HEADING_INTERVAL_MS
}

export function phoneHeadingSmoothingAlphaForTest(previous: number, next: number): number {
  const delta = headingDeltaDeg(previous, next)
  const speedRatio = clamp(Math.abs(delta) / PHONE_HEADING_FULL_SPEED_DELTA_DEG, 0, 1)
  return (
    PHONE_HEADING_MIN_SMOOTHING_ALPHA +
    (PHONE_HEADING_MAX_SMOOTHING_ALPHA - PHONE_HEADING_MIN_SMOOTHING_ALPHA) * speedRatio
  )
}

export async function startPhoneHeadingUpdates(
  adapter: PhoneHeadingAdapter,
  onHeading: (headingDeg: number) => void,
): Promise<PhoneHeadingSubscription> {
  const available = await adapter.isAvailableAsync()
  if (!available) return { status: 'unavailable', remove() {} }

  const existingPermission = await adapter.getPermissionsAsync()
  const permission =
    existingPermission.status === 'granted'
      ? existingPermission
      : await adapter.requestPermissionsAsync()
  if (permission.status !== 'granted') return { status: 'denied', remove() {} }

  adapter.setUpdateInterval(PHONE_HEADING_INTERVAL_MS)
  const subscription = adapter.addListener((event) => {
    const heading = phoneHeadingFromDeviceMotion(event, adapter.headingOffsetDeg)
    if (heading != null) onHeading(heading)
  })
  return { status: 'ready', remove: () => subscription.remove() }
}
