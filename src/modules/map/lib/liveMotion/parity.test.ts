import { expect, test } from 'bun:test'
import fixtures from '../../../../../shared/fixtures/live-map-motion.json'
import { LiveGpsMotion } from './motion'
import { defaultMotionConfig } from './config'

interface Event {
  op: string
  now: number
  source?: number
  timestamp?: number
  eastM?: number
  northM?: number
  accuracyM?: number
  ageMs?: number
  mps?: number
  accepted?: boolean
  cadenceMs?: number
  heading?: number | null
  cameraHeading?: number | null
  prediction?: number
  cameraWindow?: number
  predictionStrength?: number
  recovering?: boolean
}
for (const scenario of fixtures.scenarios)
  test(`shared motion fixture: ${scenario.name}`, () => {
    const motion = new LiveGpsMotion()
    let source = 1
    for (const event of scenario.events as Event[]) {
      const at = event.now
      if (event.op === 'reset') {
        source = event.source!
        motion.reset(source, at)
      }
      if (event.op === 'fix')
        expect(
          motion.accept(
            {
              longitude: event.eastM! / 111320,
              latitude: (event.northM ?? 0) / 110574,
              timestamp: event.timestamp ?? at,
              accuracyM: event.accuracyM ?? 3,
            },
            at,
            event.ageMs ?? 0,
            event.source ?? source,
          ),
        ).toBe(event.accepted ?? true)
      if (event.op === 'speed')
        expect(motion.updateSpeed(event.mps!, at, at, event.source ?? source)).toBe(
          event.accepted ?? true,
        )
      if (event.op === 'config') motion.configure({ ...defaultMotionConfig, ...event }, at)
      if (event.op !== 'sample') continue
      const coordinate = motion.position(at)!
      if (event.eastM != null) expect(coordinate[0] * 111320).toBeCloseTo(event.eastM, 4)
      if (event.northM != null) expect(coordinate[1] * 110574).toBeCloseTo(event.northM, 4)
      if ('heading' in event) expect(motion.pointHeading(at)).toEqual(event.heading ?? null)
      if ('cameraHeading' in event) {
        if (event.cameraHeading == null) expect(motion.cameraHeading(at)).toBeNull()
        else expect(motion.cameraHeading(at)).toBeCloseTo(event.cameraHeading, 4)
      }
      if (event.cadenceMs != null) expect(motion.cadenceMs).toBe(event.cadenceMs)
      const evidence = motion.diagnostics(at)
      if (event.prediction != null)
        expect(evidence.effectivePrediction).toBeCloseTo(event.prediction, 5)
      if (event.recovering != null) expect(evidence.recovering).toBe(event.recovering)
    }
  })
