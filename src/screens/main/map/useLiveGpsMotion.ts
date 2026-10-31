import Mapbox from '@rnmapbox/maps'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import { DisplayClock } from '@/modules/map/lib/liveMotion/clock'
import { useEffect, useState } from 'react'
import {
  addLiveStateListener,
  addLiveTickListener,
  addLocationListener,
  getLiveState,
  setWatchDisplayConfig,
  type LocationEvent,
  type TelemetryEvent,
} from 'vescape-core'
import { LiveGpsMotion } from '@/modules/map/lib/liveMotion/motion'
import { useLiveMotionSettings } from '@/modules/map/store/liveMotionSettings'
import { useNavigationDiagnosticsStore } from '@/modules/map/store/navigationDiagnosticsStore'

/** Measurements stay native. Only a visible map subscribes to this transient display owner. */
class PhoneMapDisplay {
  private listeners = new Set<() => void>()
  readonly clock = new DisplayClock()
  readonly motion = new LiveGpsMotion()
  readonly pointAnimator = new Mapbox.__experimental.MovePointShapeAnimator(
    MAP_DEFAULTS.fallbackCoordinate,
  )
  active = false
  now = () => this.clock.now(performance.now())
  duration = (ms: number) => this.clock.duration(ms)
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  changed = () => {
    for (const listener of this.listeners) listener()
  }
  activate(active: boolean) {
    this.active = active
    if (!active) this.changed()
  }
}

export function useLiveGpsMotion(
  active: boolean,
  fallback: { longitude: number; latitude: number } | null,
) {
  const [runtime] = useState(() => new PhoneMapDisplay())
  useEffect(() => {
    runtime.activate(active)
    if (!active) return
    setWatchDisplayConfig(useLiveMotionSettings.getState().config)
    let clockRate = 1
    let source = -1
    let lastSpeed: number | null = null
    let generation = 0
    let pendingSpeed: TelemetryEvent | null = null
    let speedTimer: ReturnType<typeof setTimeout> | null = null
    const now = runtime.now
    function adoptSource(id: number | undefined, clock: number | undefined, rate = 1) {
      if (id == null || clock == null || id < source) return false
      const reset = id > source
      if (reset) {
        source = id
        runtime.motion.reset(source, now())
        if (speedTimer) clearTimeout(speedTimer)
        speedTimer = null
        pendingSpeed = null
      }
      const observed = runtime.clock.observeSource(clock, rate, performance.now(), reset)
      if (observed && rate !== clockRate) {
        clockRate = rate
        runtime.changed()
      }
      return true
    }
    function fix(location: LocationEvent) {
      if (
        !adoptSource(location.displaySourceId, location.displayClockMs, location.displayClockRate)
      )
        return
      const at = now()
      const previous = runtime.motion.diagnostics(at).effectivePrediction
      const accepted = runtime.motion.accept(
        location,
        at,
        runtime.clock.age(location.timestamp, performance.now()),
        source,
      )
      if (accepted || previous !== runtime.motion.diagnostics(at).effectivePrediction)
        runtime.changed()
    }
    function speed() {
      speedTimer = null
      const tick = pendingSpeed
      pendingSpeed = null
      if (!tick || (tick.generation != null && tick.generation !== generation)) return
      const at = now()
      const age = runtime.clock.age(tick.lastPacketAt, performance.now())
      const previousPrediction = runtime.motion.diagnostics(at).effectivePrediction
      const mps = age < runtime.motion.config.telemetryFreshnessS * 1000 ? tick.speed / 3.6 : null
      if (runtime.motion.updateSpeed(mps, tick.lastPacketAt, at, source, age)) {
        if (
          lastSpeed !== mps ||
          previousPrediction !== runtime.motion.diagnostics(at).effectivePrediction
        )
          runtime.changed()
        lastSpeed = mps
      }
    }
    const stateSub = addLiveStateListener((state) => {
      if (state.board.connectionSeq < generation) return
      generation = state.board.connectionSeq
      if (
        !adoptSource(
          state.gps.displaySourceId,
          state.gps.displayClockMs,
          state.gps.displayClockRate,
        )
      )
        return
      if (state.board.phase !== 'connected') {
        pendingSpeed = null
        runtime.motion.updateSpeed(null, runtime.clock.sourceTime(performance.now()), now(), source)
        runtime.changed()
      }
    })
    runtime.motion.configure(useLiveMotionSettings.getState().config, now())
    const initial = getLiveState()
    generation = initial.board.connectionSeq
    adoptSource(
      initial.gps.displaySourceId,
      initial.gps.displayClockMs,
      initial.gps.displayClockRate,
    )
    const latest = initial.gps.latestPreciseFix ?? initial.gps.latestFix
    if (latest)
      fix({
        ...latest,
        displaySourceId: initial.gps.displaySourceId,
        displayClockMs: initial.gps.displayClockMs,
        displayClockRate: initial.gps.displayClockRate,
      })
    pendingSpeed = initial.board.recentTelemetry.at(-1) ?? null
    speed()
    const fixes = addLocationListener(fix)
    const speeds = addLiveTickListener((tick) => {
      pendingSpeed = tick
      // Coalesce telemetry away from React. A stop takes effect immediately.
      if (tick.speed === 0) {
        if (speedTimer) clearTimeout(speedTimer)
        speed()
      } else if (!speedTimer) speedTimer = setTimeout(speed, 100)
    })
    const settings = useLiveMotionSettings.subscribe((state) => {
      runtime.motion.configure(state.config, now())
      runtime.changed()
    })
    const diagnostics = setInterval(() => {
      useNavigationDiagnosticsStore.setState({ motion: runtime.motion.diagnostics(now()) })
    }, 1000)
    return () => {
      runtime.activate(false)
      stateSub.remove()
      fixes.remove()
      speeds.remove()
      settings()
      clearInterval(diagnostics)
      if (speedTimer) clearTimeout(speedTimer)
    }
  }, [active, runtime])
  useEffect(() => {
    if (active && !runtime.motion.position(runtime.now()) && fallback)
      runtime.pointAnimator.moveTo({
        coordinate: [fallback.longitude, fallback.latitude],
        durationMs: 0,
      })
  }, [active, fallback, runtime])
  return runtime
}
export type LiveGpsRuntime = ReturnType<typeof useLiveGpsMotion>
