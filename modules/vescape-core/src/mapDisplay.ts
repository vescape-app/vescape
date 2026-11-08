/** Surface-only native display contract. Never part of Live State, Watch Frames or storage.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/display/MapDisplayCoordinator.kt
 * @parity /modules/vescape-core/ios/watch/MapDisplayCoordinator.swift
 */
/** @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/display/LiveGpsMotion.kt `MotionConfig`
 * @parity /modules/vescape-core/ios/watch/LiveGpsMotion.swift `MotionConfig`
 */
export type MotionConfig = Record<
  | 'predictionStrength'
  | 'maxPredictionM'
  | 'movementM'
  | 'cameraConfirmM'
  | 'cameraPositionOmega'
  | 'cameraHeadingOmega'
  | 'arrowHeadingOmega',
  number
>
export type MotionControls = Record<
  keyof MotionConfig,
  { value: number; min: number; max: number; step: number; unit: string }
>
/** @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/display/LiveGpsMotion.kt `MotionFix`
 * @parity /modules/vescape-core/ios/watch/LiveGpsMotion.swift `MotionFix`
 */
export interface MotionFix {
  longitude: number
  latitude: number
  timestamp: number
  accuracyM: number | null
}
export interface MotionDiagnostics {
  measured: MotionFix | null
  displayed: [number, number] | null
  cadenceMs: number
  confidence: number
  effectivePrediction: number
  directionAgeMs: number | null
  reason: string
  raw?: MapDisplaySnapshot['raw']
  recovering: boolean
}
export interface DisplaySegment {
  startMs: number
  endMs: number
  from: [number, number]
  to: [number, number]
}
export interface MapDisplaySnapshot {
  id: 'live' | 'bench'
  source: number
  revision: number
  localClockMs: number
  clockMs: number
  clockRate: number
  position: [number, number] | null
  segments: DisplaySegment[]
  pointHeading: number | null
  headingUntilMs: number | null
  cameraHeading: number | null
  diagnostics: MotionDiagnostics | null
  raw: {
    coordinate: [number, number]
    timestamp: number
    atMs: number
    accuracyM: number | null
    accepted: boolean
    stale: boolean
  } | null
  trail: [number, number][]
}
