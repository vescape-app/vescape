import { useLiveMotionSettings } from '@/modules/map/store/liveMotionSettings'
import { useEffect, type RefObject } from 'react'
import type { MotionDisplay } from '@/modules/map/lib/liveMotion/display'
import type { CameraEngine, CameraEngineTarget } from '@/modules/map/lib/cameraEngine/engine'
import type { MapCameraControllerState } from '@/modules/map/lib/cameraController'

/** Segments wake the existing camera owner; hidden surfaces hold no display subscription. */
export function useMotionCameraFollow({
  motion,
  engine,
  sample,
  controller,
  active,
  enabled,
  gpsHeading,
}: {
  motion: MotionDisplay
  engine: CameraEngine
  sample: () => CameraEngineTarget | null
  controller: RefObject<MapCameraControllerState>
  active: boolean
  enabled: boolean
  gpsHeading: boolean
}) {
  const config = useLiveMotionSettings((state) => state.config)
  useEffect(
    () =>
      engine.configureOmega({
        center: config.cameraPositionOmega,
        heading: gpsHeading ? config.cameraHeadingOmega : 8,
      }),
    [engine, config, gpsHeading],
  )
  useEffect(() => {
    engine.follow(active && enabled ? sample : null)
    if (!active) engine.stop()
    return () => engine.follow(null)
  }, [active, enabled, engine, sample])
  useEffect(() => {
    if (!active || !enabled) return
    return motion.subscribe(() => {
      if (controller.current.mode.kind === 'liveFollow') engine.follow(sample)
    })
  }, [active, enabled, motion, engine, sample, controller])
}
