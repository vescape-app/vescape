import { distanceMeters } from '@/helpers/mapGeometry'

import {
  createSpring,
  driveSpring,
  nearestBearingTarget,
  normalizeBearing,
  retargetSpring,
  shortestArcDelta,
  snapSpring,
  springSettled,
  stepSpring,
  type SpringState,
} from './springs'

export interface EnginePadding {
  paddingTop: number
  paddingRight: number
  paddingBottom: number
  paddingLeft: number
}

export interface EngineCamera {
  centerCoordinate: [number, number]
  zoomLevel: number
  heading: number
  pitch: number
  padding?: EnginePadding
}

export interface CameraEngineTarget {
  center?: [number, number]
  zoom?: number
  heading?: number
  /** Explicit pitch target; when omitted and `derivePitch` is configured, pitch follows zoom. */
  pitch?: number
  padding?: EnginePadding
}

export interface CameraEngineConfig {
  /** Called once per frame while any spring is in motion. */
  applyFrame: (camera: EngineCamera) => void
  /**
   * Cancel whatever the map is animating on its own — a fling, mostly. Called
   * once when an app-issued target takes the camera, never per frame: the
   * engine's own writes go through a non-transitioning setter that leaves
   * native animators running, and a live fling overwrites every frame it
   * writes.
   */
  cancelNativeMotion?: () => void
  /** Stiffness per axis, rad/s. */
  omega?: Partial<CameraEngineOmega>
  /** Pitch derived from the animated zoom each frame, unless a pitch target was set explicitly. */
  derivePitch?: (zoom: number) => number
  /** Center retargets farther than this snap instead of animating. */
  teleportDistanceM?: number
  /**
   * Ballistic transit zoom: while the center is still far from its target, the
   * zoom target is capped so the remaining travel fits ~`fitPx` screen pixels,
   * then released back to the requested zoom as the center arrives — a smooth
   * out-and-back arc for mid-distance jumps. Pass `false` to disable.
   */
  ballistic?: { fitPx?: number; minZoom?: number } | false
  /**
   * How long after a camera write the map's change events are still assumed to
   * be echoes of it. Non-gesture `driveExternal` samples inside the window are
   * discarded. See `driveExternal`.
   */
  echoWindowMs?: number
  /**
   * A drive sample this far (in screen pixels) from the previous one is a
   * reposition, not motion — velocity is not derived across it. See
   * `driveExternal`.
   */
  maxDriveJumpPx?: number
  /**
   * How long the engine keeps asserting the camera after landing on a target.
   * A native fling decelerates on its own animator, which no JS call cancels;
   * holding the frame loop open re-writes the camera over what is left of it.
   */
  holdAfterTargetMs?: number
  /** Injectable for tests. Defaults to requestAnimationFrame. */
  scheduleFrame?: (callback: (timestampMs: number) => void) => number
  cancelFrame?: (handle: number) => void
  /** Injectable for tests. Milliseconds clock used to time `driveExternal` samples. */
  now?: () => number
}

export interface CameraEngineOmega {
  center: number
  zoom: number
  heading: number
  pitch: number
  padding: number
}

export const CAMERA_ENGINE_DEFAULT_OMEGA: CameraEngineOmega = {
  center: 6,
  zoom: 5,
  heading: 8,
  pitch: 5,
  padding: 7,
}

export const CAMERA_ENGINE_DEFAULT_TELEPORT_DISTANCE_M = 10_000
export const CAMERA_ENGINE_DEFAULT_BALLISTIC_FIT_PX = 320
export const CAMERA_ENGINE_DEFAULT_BALLISTIC_MIN_ZOOM = 3
const CAMERA_ENGINE_DEFAULT_ECHO_WINDOW_MS = 300
const CAMERA_ENGINE_DEFAULT_MAX_DRIVE_JUMP_PX = 200
const CAMERA_ENGINE_DEFAULT_HOLD_AFTER_TARGET_MS = 500

/** Web-mercator meters per pixel at zoom 0 (256px tiles). */
const METERS_PER_PIXEL_ZOOM_0 = 156_543.033_92

function metersPerPixelAtZoom0(latitudeDeg: number): number {
  return METERS_PER_PIXEL_ZOOM_0 * Math.cos((latitudeDeg * Math.PI) / 180)
}

function metersPerPixel(latitudeDeg: number, zoom: number): number {
  return metersPerPixelAtZoom0(latitudeDeg) / 2 ** zoom
}

/** Zoom at which `distanceM` spans `fitPx` screen pixels at this latitude. */
function zoomToFitDistance(distanceM: number, latitudeDeg: number, fitPx: number): number {
  if (distanceM <= 0) return Number.POSITIVE_INFINITY
  return Math.log2((metersPerPixelAtZoom0(latitudeDeg) * fitPx) / distanceM)
}

const MAX_FRAME_DT_S = 0.064
/**
 * Gesture samples closer together than this are coalesced: a stalled JS thread
 * drains queued touch events in sub-millisecond bursts, and a delta divided by
 * 1 ms reads as thousands of metres per second. The position still follows the
 * finger; only the clock waits for a sample worth differentiating.
 */
const MIN_DRIVE_DT_S = 0.012
/** Weight of the newest sample in the drive velocity estimate. */
const DRIVE_VELOCITY_SMOOTHING = 0.35
const CENTER_EPSILON_DEG = 1e-7
const ZOOM_EPSILON = 1e-4
const ANGLE_EPSILON_DEG = 1e-3
const PADDING_EPSILON_PX = 0.1

/**
 * Below these a frame would redraw the map identically, so the write is skipped.
 *
 * Every camera write is expensive far out of proportion to its size: the native setter fires
 * `onCameraChanged` synchronously, which builds an event payload for JS and commits a Core
 * Animation transform for the compass ornament. In compass mode the heading spring is retargeted
 * from a 60 Hz sensor and never settles, so those writes run for the whole ride — enough to
 * exhaust the scene-update watchdog. Dropping the sub-pixel ones costs nothing visually and
 * removes whole frames rather than making each one cheaper.
 *
 * Thresholds are one step under what a pixel can show: ~11 cm of centre, and a rotation that moves
 * a point at the edge of a phone-width viewport by well under a pixel.
 */
const EMIT_CENTER_EPSILON_DEG = 1e-6
const EMIT_ZOOM_EPSILON = 1e-4
const EMIT_ANGLE_EPSILON_DEG = 0.02
const EMIT_PADDING_EPSILON_PX = 0.25

const PADDING_KEYS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const

export interface DriveOptions {
  /** Sample interval; omit to let the engine time samples itself. */
  dtSeconds?: number
  /** A finger is driving. Gesture samples are always trusted. */
  gesture?: boolean
}

interface EngineSprings {
  lng: SpringState
  lat: SpringState
  zoom: SpringState
  heading: SpringState
  pitch: SpringState
  padding: [SpringState, SpringState, SpringState, SpringState]
}

export interface CameraEngine {
  /** React development remounts effects while preserving state; make the retained engine usable again. */
  resume: () => void
  /** Initialize springs at rest on a known camera. Until called, targets snap. */
  reset: (camera: EngineCamera) => void
  /** Retarget springs; motion continues from current position and velocity. */
  setTarget: (target: CameraEngineTarget) => void
  /** Jump instantly, killing velocity on the snapped axes. */
  snap: (target: CameraEngineTarget) => void
  /**
   * Gesture pass-through: camera is externally positioned this frame. Springs
   * shadow-track position and velocity so the next setTarget blends out of the
   * gesture without a jump. Does not call applyFrame — the driver already owns
   * the camera.
   *
   * Omit `dtSeconds` to have the engine time the samples itself — gesture
   * callbacks do not arrive at frame rate, and a wrong dt scales the release
   * velocity. The first sample after any retarget carries no velocity.
   *
   * Pass `gesture: true` when a finger is on the screen. Without it the sample
   * is assumed to be the map mirroring a camera write back at us, and is
   * discarded while an echo could still be in flight.
   */
  driveExternal: (camera: EngineCamera, options?: DriveOptions) => void
  /**
   * End a drive without a destination: each axis coasts to rest on its own
   * velocity. Target is `x + v/ω`, the point a critically damped spring reaches
   * without ever reversing — a glide, not a wall.
   */
  release: () => void
  /** Halt in place: park every spring where it is, kill velocity, stop the loop. */
  stop: () => void
  /** True while the frame loop is running. */
  isAnimating: () => boolean
  getCamera: () => EngineCamera
  destroy: () => void
}

export function createCameraEngine(config: CameraEngineConfig): CameraEngine {
  const omega: CameraEngineOmega = { ...CAMERA_ENGINE_DEFAULT_OMEGA, ...config.omega }
  const teleportDistanceM = config.teleportDistanceM ?? CAMERA_ENGINE_DEFAULT_TELEPORT_DISTANCE_M
  const echoWindowMs = config.echoWindowMs ?? CAMERA_ENGINE_DEFAULT_ECHO_WINDOW_MS
  const maxDriveJumpPx = config.maxDriveJumpPx ?? CAMERA_ENGINE_DEFAULT_MAX_DRIVE_JUMP_PX
  const holdAfterTargetMs = config.holdAfterTargetMs ?? CAMERA_ENGINE_DEFAULT_HOLD_AFTER_TARGET_MS
  const scheduleFrame =
    config.scheduleFrame ?? ((callback) => requestAnimationFrame(callback) as unknown as number)
  const cancelFrame =
    config.cancelFrame ?? ((handle) => cancelAnimationFrame(handle as unknown as number))

  const ballistic =
    config.ballistic === false
      ? null
      : {
          fitPx: config.ballistic?.fitPx ?? CAMERA_ENGINE_DEFAULT_BALLISTIC_FIT_PX,
          minZoom: config.ballistic?.minZoom ?? CAMERA_ENGINE_DEFAULT_BALLISTIC_MIN_ZOOM,
        }

  let springs: EngineSprings | null = null
  /** The zoom the caller asked for; the ballistic cap adjusts around it. */
  let zoomUserTarget = 0
  let pitchFollowsZoom = config.derivePitch != null
  let frameHandle: number | null = null
  let lastFrameMs: number | null = null
  /** Timestamp of the previous `driveExternal` sample; null starts a new drive. */
  let lastDriveMs: number | null = null
  /**
   * True while applyFrame runs. The map answers a camera write with a change
   * event, and that echo must not be mistaken for an external driver.
   */
  let emitting = false
  let destroyed = false
  /** When the engine last wrote the camera; echoes of that write follow it. */
  let lastEmitMs = Number.NEGATIVE_INFINITY
  /** The camera of the last write, to measure whether the next one would show. */
  let lastEmittedCamera: EngineCamera | null = null
  /**
   * A target the app asked for is in flight. The map is not authoritative until
   * it lands: a fling started before the target keeps reporting its own
   * deceleration, and taking those samples would retarget the springs onto
   * wherever the throw was heading. Only a finger clears it.
   */
  let targetOwned = false
  /** Deadline until which a landed target keeps being re-asserted; null when idle. */
  let holdUntilMs: number | null = null
  const now = config.now ?? (() => Date.now())

  const toCamera = (s: EngineSprings): EngineCamera => ({
    centerCoordinate: [s.lng.x, s.lat.x],
    zoomLevel: s.zoom.x,
    heading: normalizeBearing(s.heading.x),
    pitch: s.pitch.x,
    padding: {
      paddingTop: s.padding[0].x,
      paddingRight: s.padding[1].x,
      paddingBottom: s.padding[2].x,
      paddingLeft: s.padding[3].x,
    },
  })

  const eachPadding = (
    s: EngineSprings,
    padding: EnginePadding | undefined,
    apply: (spring: SpringState, target: number) => SpringState,
  ): EngineSprings['padding'] =>
    padding
      ? (s.padding.map((spring, i) =>
          apply(spring, padding[PADDING_KEYS[i]!]),
        ) as EngineSprings['padding'])
      : s.padding

  const settled = (s: EngineSprings) =>
    springSettled(s.lng, CENTER_EPSILON_DEG, CENTER_EPSILON_DEG) &&
    springSettled(s.lat, CENTER_EPSILON_DEG, CENTER_EPSILON_DEG) &&
    springSettled(s.zoom, ZOOM_EPSILON, ZOOM_EPSILON) &&
    springSettled(s.heading, ANGLE_EPSILON_DEG, ANGLE_EPSILON_DEG) &&
    springSettled(s.pitch, ANGLE_EPSILON_DEG, ANGLE_EPSILON_DEG) &&
    s.padding.every((p) => springSettled(p, PADDING_EPSILON_PX, PADDING_EPSILON_PX))

  /**
   * True when this frame would land the map somewhere a rider could tell apart from the last one
   * the engine wrote.
   */
  const worthWriting = (camera: EngineCamera) => {
    const previous = lastEmittedCamera
    if (!previous) return true
    return (
      Math.abs(camera.centerCoordinate[0] - previous.centerCoordinate[0]) >=
        EMIT_CENTER_EPSILON_DEG ||
      Math.abs(camera.centerCoordinate[1] - previous.centerCoordinate[1]) >=
        EMIT_CENTER_EPSILON_DEG ||
      Math.abs(camera.zoomLevel - previous.zoomLevel) >= EMIT_ZOOM_EPSILON ||
      Math.abs(shortestArcDelta(camera.heading - previous.heading)) >= EMIT_ANGLE_EPSILON_DEG ||
      Math.abs(camera.pitch - previous.pitch) >= EMIT_ANGLE_EPSILON_DEG ||
      PADDING_KEYS.some(
        (key) =>
          Math.abs((camera.padding?.[key] ?? 0) - (previous.padding?.[key] ?? 0)) >=
          EMIT_PADDING_EPSILON_PX,
      )
    )
  }

  /**
   * `force` writes even an invisible change. The landing frame uses it so the map rests exactly on
   * target, and the post-landing hold uses it because those writes exist to overwrite a native
   * fling animator that is still moving the camera underneath — skipping one hands the frame back
   * to the fling.
   */
  const emit = (s: EngineSprings, options?: { force?: boolean }) => {
    const camera = toCamera(s)
    if (!options?.force && !worthWriting(camera)) return
    emitting = true
    try {
      config.applyFrame(camera)
    } finally {
      emitting = false
      lastEmittedCamera = camera
      lastEmitMs = now()
    }
  }

  const stopLoop = () => {
    if (frameHandle != null) cancelFrame(frameHandle)
    frameHandle = null
    lastFrameMs = null
  }

  const centerDistanceToTargetM = (s: EngineSprings) =>
    distanceMeters(
      { longitude: s.lng.x, latitude: s.lat.x },
      { longitude: s.lng.target, latitude: s.lat.target },
    )

  const frame = (timestampMs: number) => {
    frameHandle = null
    if (destroyed || !springs) return
    const dt = Math.min(
      lastFrameMs == null ? 1 / 60 : Math.max(0, (timestampMs - lastFrameMs) / 1000),
      MAX_FRAME_DT_S,
    )
    lastFrameMs = timestampMs

    let s = springs
    if (ballistic) {
      const remainingM = centerDistanceToTargetM(s)
      const fitZoom = zoomToFitDistance(remainingM, s.lat.x, ballistic.fitPx)
      s.zoom = retargetSpring(
        s.zoom,
        Math.min(zoomUserTarget, Math.max(fitZoom, ballistic.minZoom)),
      )
    }
    s = {
      lng: stepSpring(s.lng, omega.center, dt),
      lat: stepSpring(s.lat, omega.center, dt),
      zoom: stepSpring(s.zoom, omega.zoom, dt),
      heading: stepSpring(s.heading, omega.heading, dt),
      pitch: stepSpring(s.pitch, omega.pitch, dt),
      padding: s.padding.map((p) => stepSpring(p, omega.padding, dt)) as EngineSprings['padding'],
    }
    if (pitchFollowsZoom && config.derivePitch) {
      s.pitch = retargetSpring(s.pitch, config.derivePitch(s.zoom.x))
    }
    springs = s
    emit(s)

    if (settled(s)) {
      // Land exactly on target so the map doesn't rest epsilon off.
      springs = {
        lng: snapSpring(s.lng, s.lng.target),
        lat: snapSpring(s.lat, s.lat.target),
        zoom: snapSpring(s.zoom, s.zoom.target),
        heading: snapSpring(s.heading, s.heading.target),
        pitch: snapSpring(s.pitch, s.pitch.target),
        padding: s.padding.map((p) => snapSpring(p, p.target)) as EngineSprings['padding'],
      }
      emit(springs, { force: true })
      // Landing is not arriving: a fling animator the map started before this
      // target is still writing the camera, and it outlives the springs. Keep
      // the loop open for the hold window so every one of those writes is
      // overwritten by the target, then let go.
      if (holdUntilMs != null && now() < holdUntilMs) {
        frameHandle = scheduleFrame(frame)
        return
      }
      holdUntilMs = null
      targetOwned = false
      lastFrameMs = null
      return
    }
    frameHandle = scheduleFrame(frame)
  }

  const ensureLoop = () => {
    if (destroyed || frameHandle != null) return
    if (springs && settled(springs) && (holdUntilMs == null || now() >= holdUntilMs)) {
      holdUntilMs = null
      targetOwned = false
      return
    }
    frameHandle = scheduleFrame(frame)
  }

  /** Claim the camera for an app-issued target and arm the post-landing hold. */
  const claimTarget = () => {
    // Only the first claim cancels: retargets during an animation the engine
    // already owns have nothing native left to stop.
    if (!targetOwned) config.cancelNativeMotion?.()
    targetOwned = true
    holdUntilMs = now() + holdAfterTargetMs
  }

  const resolvePitchTarget = (target: CameraEngineTarget, zoomTarget: number) => {
    if (target.pitch != null) {
      pitchFollowsZoom = false
      return target.pitch
    }
    if (config.derivePitch) {
      pitchFollowsZoom = true
      return config.derivePitch(zoomTarget)
    }
    return null
  }

  const reset = (camera: EngineCamera) => {
    stopLoop()
    lastDriveMs = null
    targetOwned = false
    holdUntilMs = null
    zoomUserTarget = camera.zoomLevel
    const padding = camera.padding
    springs = {
      lng: createSpring(camera.centerCoordinate[0]),
      lat: createSpring(camera.centerCoordinate[1]),
      zoom: createSpring(camera.zoomLevel),
      heading: createSpring(camera.heading),
      pitch: createSpring(camera.pitch),
      padding: PADDING_KEYS.map((key) =>
        createSpring(padding?.[key] ?? 0),
      ) as EngineSprings['padding'],
    }
    // The map is already parked here, so the next frame is measured against it rather than being
    // written unconditionally for want of anything to compare to.
    lastEmittedCamera = toCamera(springs)
  }

  const snap = (target: CameraEngineTarget) => {
    if (!springs) return
    lastDriveMs = null
    claimTarget()
    const s = springs
    if (target.zoom != null) zoomUserTarget = target.zoom
    const zoomTarget = target.zoom ?? zoomUserTarget
    const pitchTarget = resolvePitchTarget(target, zoomTarget)
    springs = {
      lng: target.center ? snapSpring(s.lng, target.center[0]) : s.lng,
      lat: target.center ? snapSpring(s.lat, target.center[1]) : s.lat,
      zoom: target.zoom != null ? snapSpring(s.zoom, target.zoom) : s.zoom,
      heading:
        target.heading != null
          ? snapSpring(s.heading, nearestBearingTarget(s.heading.x, target.heading))
          : s.heading,
      pitch: pitchTarget != null ? snapSpring(s.pitch, pitchTarget) : s.pitch,
      padding: eachPadding(s, target.padding, snapSpring),
    }
    emit(springs)
    ensureLoop()
  }

  const setTarget = (target: CameraEngineTarget) => {
    if (!springs) return
    lastDriveMs = null
    claimTarget()
    if (target.center) {
      const from = { longitude: springs.lng.x, latitude: springs.lat.x }
      const to = { longitude: target.center[0], latitude: target.center[1] }
      if (distanceMeters(from, to) > teleportDistanceM) {
        snap(target)
        return
      }
    }
    const s = springs
    if (target.zoom != null) zoomUserTarget = target.zoom
    const zoomTarget = target.zoom ?? zoomUserTarget
    const pitchTarget = resolvePitchTarget(target, zoomTarget)
    springs = {
      lng: target.center ? retargetSpring(s.lng, target.center[0]) : s.lng,
      lat: target.center ? retargetSpring(s.lat, target.center[1]) : s.lat,
      zoom: target.zoom != null ? retargetSpring(s.zoom, target.zoom) : s.zoom,
      heading:
        target.heading != null
          ? retargetSpring(s.heading, nearestBearingTarget(s.heading.x, target.heading))
          : s.heading,
      pitch: pitchTarget != null ? retargetSpring(s.pitch, pitchTarget) : s.pitch,
      padding: eachPadding(s, target.padding, retargetSpring),
    }
    ensureLoop()
  }

  const driveExternal = (camera: EngineCamera, options?: DriveOptions) => {
    if (emitting) return
    if (!springs) {
      reset(camera)
      return
    }
    const sampleMs = now()
    if (options?.gesture) {
      // A finger takes the camera back: whatever target was in flight is gone.
      targetOwned = false
      holdUntilMs = null
    } else if (targetOwned) {
      // Momentum from a throw that predates the target, or an echo of the
      // engine's own write. Neither is a driver.
      lastDriveMs = null
      return
    }
    // The map answers every camera write with a change event, and that echo
    // arrives a frame or more later — long after the synchronous `emitting`
    // guard has closed. Two echoes straddling one write (the stale camera, then
    // the written one) differentiate into the engine's own jump: a teleport
    // reads as tens of degrees per second, and the next retarget launches at
    // that speed. Worse, a stale echo moves the springs backwards, so the
    // teleport test in `setTarget` measures from the wrong place and the same
    // A→B sometimes snaps and sometimes crawls. A finger is authoritative and
    // always passes; anything else waits for the echoes to drain.
    if (!options?.gesture && sampleMs - lastEmitMs < echoWindowMs) {
      lastDriveMs = null
      return
    }
    stopLoop()
    const dtSeconds = options?.dtSeconds
    // Velocity is a derivative, so it only means anything across samples of one
    // continuous motion. A sample that jumps further than a finger could travel
    // is someone repositioning the camera, not moving it: take the position and
    // start a fresh drive rather than differentiating across the discontinuity.
    // This is what survives a stalled JS thread, where an echo can outlive the
    // window above.
    const jumpPx =
      distanceMeters(
        { longitude: springs.lng.x, latitude: springs.lat.x },
        { longitude: camera.centerCoordinate[0], latitude: camera.centerCoordinate[1] },
      ) / metersPerPixel(springs.lat.x, springs.zoom.x)
    const repositioned = jumpPx > maxDriveJumpPx
    const opening = lastDriveMs == null || repositioned
    const dt =
      dtSeconds ?? (opening ? 0 : Math.min((sampleMs - lastDriveMs!) / 1000, MAX_FRAME_DT_S))
    // Burst samples leave the clock where it is, so the next real sample
    // measures across the whole burst instead of one starved millisecond.
    const timed = dt >= MIN_DRIVE_DT_S
    if (opening || timed) lastDriveMs = sampleMs
    // The opening sample of a drive has no measurable velocity; parking on it
    // beats inheriting whatever the spring was doing before the gesture.
    const drive = (spring: SpringState, x: number): SpringState => {
      if (opening) return snapSpring(spring, x)
      if (!timed) return { x, v: spring.v, target: x }
      const sampled = driveSpring(spring, x, dt)
      return {
        ...sampled,
        v: spring.v + (sampled.v - spring.v) * DRIVE_VELOCITY_SMOOTHING,
      }
    }
    zoomUserTarget = camera.zoomLevel
    const s = springs
    springs = {
      lng: drive(s.lng, camera.centerCoordinate[0]),
      lat: drive(s.lat, camera.centerCoordinate[1]),
      zoom: drive(s.zoom, camera.zoomLevel),
      heading: drive(s.heading, nearestBearingTarget(s.heading.x, camera.heading)),
      pitch: drive(s.pitch, camera.pitch),
      padding: eachPadding(s, camera.padding, drive),
    }
  }

  const release = () => {
    if (!springs) return
    lastDriveMs = null
    targetOwned = false
    holdUntilMs = null
    const s = springs
    const coast = (spring: SpringState, axisOmega: number) =>
      retargetSpring(spring, spring.x + spring.v / axisOmega)
    springs = {
      lng: coast(s.lng, omega.center),
      lat: coast(s.lat, omega.center),
      zoom: coast(s.zoom, omega.zoom),
      heading: coast(s.heading, omega.heading),
      pitch: coast(s.pitch, omega.pitch),
      padding: s.padding.map((p) => coast(p, omega.padding)) as EngineSprings['padding'],
    }
    zoomUserTarget = springs.zoom.target
    ensureLoop()
  }

  const stop = () => {
    stopLoop()
    lastDriveMs = null
    targetOwned = false
    holdUntilMs = null
    if (!springs) return
    const s = springs
    springs = {
      lng: snapSpring(s.lng, s.lng.x),
      lat: snapSpring(s.lat, s.lat.x),
      zoom: snapSpring(s.zoom, s.zoom.x),
      heading: snapSpring(s.heading, s.heading.x),
      pitch: snapSpring(s.pitch, s.pitch.x),
      padding: s.padding.map((p) => snapSpring(p, p.x)) as EngineSprings['padding'],
    }
    zoomUserTarget = s.zoom.x
  }

  return {
    resume: () => {
      destroyed = false
    },
    reset,
    setTarget,
    snap,
    driveExternal,
    release,
    stop,
    isAnimating: () => frameHandle != null || emitting,
    getCamera: () => {
      if (!springs) throw new Error('CameraEngine.getCamera called before reset')
      return toCamera(springs)
    },
    destroy: () => {
      destroyed = true
      stopLoop()
    },
  }
}
