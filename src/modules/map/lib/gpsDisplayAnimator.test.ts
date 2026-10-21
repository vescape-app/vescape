import { expect, test } from 'bun:test'
import { GpsDisplayAnimatorController } from './gpsDisplayAnimator'
import type { GpsDisplayMotion } from 'vescape-core'

const motion: GpsDisplayMotion = {
  fromLatitude: 0,
  fromLongitude: 0,
  toLatitude: 0,
  toLongitude: 1,
  startsAtMs: 10_000,
  endsAtMs: 11_000,
  longitudePerMs: 0.001,
  latitudePerMs: 0,
  velocityExpiresAtMs: 12_000,
  resetPosition: false,
}

test('forwards correction and velocity natively without reducing them to an endpoint animation', () => {
  const models: GpsDisplayMotion[] = []
  const snaps: unknown[] = []
  const controller = new GpsDisplayAnimatorController({
    moveTo: (value) => snaps.push(value),
    setMotion: (value) => models.push(value),
  })
  controller.update(motion, true, 10_100)
  controller.update({ ...motion, longitudePerMs: 0, endsAtMs: 10_000 }, true, 10_400)
  controller.update({ ...motion, resetPosition: true, endsAtMs: 10_000 }, true, 10_500)
  expect(models[0]).toEqual({ ...motion, resetPosition: true })
  expect(models[1]?.resetPosition).toBe(false)
  expect(models[1]?.longitudePerMs).toBe(0)
  expect(models[2]?.resetPosition).toBe(true)
  expect(snaps).toEqual([])
})

test('hidden surfaces stop animation and initialize from the transported model when visible again', () => {
  const models: GpsDisplayMotion[] = []
  const snaps: unknown[] = []
  const controller = new GpsDisplayAnimatorController({
    moveTo: (value) => snaps.push(value),
    setMotion: (value) => models.push(value),
  })
  controller.update(motion, true, 10_000)
  controller.update(motion, false, 10_500)
  controller.update(motion, true, 10_600)
  expect(snaps).toHaveLength(1)
  expect(models[1]?.resetPosition).toBe(true)
})
