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
  pitch?: number
  padding?: EnginePadding
}

export interface CameraEngineConfig {
  applyFrame: (camera: EngineCamera) => void
  cancelNativeMotion?: () => void
  omega?: Partial<CameraEngineOmega>
  derivePitch?: (zoom: number) => number
  teleportDistanceM?: number
  ballistic?: { fitPx?: number; minZoom?: number } | false
  echoWindowMs?: number
  maxDriveJumpPx?: number
  holdAfterTargetMs?: number
  scheduleFrame?: (callback: (timestampMs: number) => void) => number
  cancelFrame?: (handle: number) => void
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

export const CAMERA_ENGINE_DEFAULT_TELEPORT_DISTANCE_M = 50_000
export const CAMERA_ENGINE_DEFAULT_BALLISTIC_FIT_PX = 320
export const CAMERA_ENGINE_DEFAULT_BALLISTIC_MIN_ZOOM = 3
const CAMERA_ENGINE_DEFAULT_ECHO_WINDOW_MS = 300
const CAMERA_ENGINE_DEFAULT_MAX_DRIVE_JUMP_PX = 200
const CAMERA_ENGINE_DEFAULT_HOLD_AFTER_TARGET_MS = 500

const METERS_PER_PIXEL_ZOOM_0 = 156_543.033_92

function metersPerPixelAtZoom0(latitudeDeg: number): number {
  return METERS_PER_PIXEL_ZOOM_0 * Math.cos((latitudeDeg * Math.PI) / 180)
}

function metersPerPixel(latitudeDeg: number, zoom: number): number {
  return metersPerPixelAtZoom0(latitudeDeg) / 2 ** zoom
}

function zoomToFitDistance(distanceM: number, latitudeDeg: number, fitPx: number): number {
  if (distanceM <= 0) return Number.POSITIVE_INFINITY
  return Math.log2((metersPerPixelAtZoom0(latitudeDeg) * fitPx) / distanceM)
}

const MAX_FRAME_DT_S = 0.064
const MIN_DRIVE_DT_S = 0.012
const DRIVE_VELOCITY_SMOOTHING = 0.35
const CENTER_EPSILON_DEG = 1e-7
const ZOOM_EPSILON = 1e-4
const ANGLE_EPSILON_DEG = 1e-3
const PADDING_EPSILON_PX = 0.1

const EMIT_CENTER_EPSILON_DEG = 1e-6
const EMIT_ZOOM_EPSILON = 1e-4
const EMIT_ANGLE_EPSILON_DEG = 0.02
const EMIT_PADDING_EPSILON_PX = 0.25

const PADDING_KEYS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const

export interface DriveOptions {
  dtSeconds?: number
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
  resume: () => void
  reset: (camera: EngineCamera) => void
  setTarget: (target: CameraEngineTarget) => void
  snap: (target: CameraEngineTarget) => void
  driveExternal: (camera: EngineCamera, options?: DriveOptions) => void
  release: () => void
  stop: () => void
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
  let zoomUserTarget = 0
  let pitchFollowsZoom = config.derivePitch != null
  let frameHandle: number | null = null
  let lastFrameMs: number | null = null
  let lastDriveMs: number | null = null
  let emitting = false
  let destroyed = false
  let lastEmitMs = Number.NEGATIVE_INFINITY
  let lastEmittedCamera: EngineCamera | null = null
  let targetOwned = false
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
      springs = {
        lng: snapSpring(s.lng, s.lng.target),
        lat: snapSpring(s.lat, s.lat.target),
        zoom: snapSpring(s.zoom, s.zoom.target),
        heading: snapSpring(s.heading, s.heading.target),
        pitch: snapSpring(s.pitch, s.pitch.target),
        padding: s.padding.map((p) => snapSpring(p, p.target)) as EngineSprings['padding'],
      }
      emit(springs, { force: true })
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

  const claimTarget = () => {
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
      targetOwned = false
      holdUntilMs = null
    } else if (targetOwned) {
      lastDriveMs = null
      return
    }
    if (!options?.gesture && sampleMs - lastEmitMs < echoWindowMs) {
      lastDriveMs = null
      return
    }
    stopLoop()
    const dtSeconds = options?.dtSeconds
    const jumpPx =
      distanceMeters(
        { longitude: springs.lng.x, latitude: springs.lat.x },
        { longitude: camera.centerCoordinate[0], latitude: camera.centerCoordinate[1] },
      ) / metersPerPixel(springs.lat.x, springs.zoom.x)
    const repositioned = jumpPx > maxDriveJumpPx
    const opening = lastDriveMs == null || repositioned
    const dt =
      dtSeconds ?? (opening ? 0 : Math.min((sampleMs - lastDriveMs!) / 1000, MAX_FRAME_DT_S))
    const timed = dt >= MIN_DRIVE_DT_S
    if (opening || timed) lastDriveMs = sampleMs
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
