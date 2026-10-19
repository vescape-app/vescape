import { describe, expect, test } from 'bun:test'
import { DEFAULT_RING_ANCHORS } from './ringCalibration'
import {
  RING_CONTROLS,
  RING_PRESETS,
  projectRingControl,
  ringControlPatch,
  ringSectionPatch,
} from './ringModel'
import { draftBoardState } from './draftBoardState'
import { constrainCircleEdit, handleCircle } from './ringGeometry'

const anchors = DEFAULT_RING_ANCHORS

describe('Rings semantic contract', () => {
  test('agreed braking anchors and signed turning zero', () => {
    expect([0, 5, 10].map((v) => ringControlPatch(anchors, 4, v).braketilt_strength)).toEqual([
      5, 2.5, 0,
    ])
    expect([0, 5, 10].map((v) => ringControlPatch(anchors, 5, v).turntilt_strength)).toEqual([
      -15, 0, 15,
    ])
    expect(ringControlPatch(anchors, 4, 4.9).braketilt_strength).toBeCloseTo(2.55)
  })
  test('every control projects its mapping without modifying raw values', () => {
    for (let control = 0; control < RING_CONTROLS.length; control++) {
      for (const value of [0, 0.1, 4.9, 5, 5.1, 9.9, 10]) {
        const raw = { ...ringControlPatch(anchors, control, value), unrelated: 0.123456789 }
        const before = JSON.stringify(raw)
        const projected = projectRingControl(anchors, control, raw)
        expect(projected.custom).toBe(false)
        expect(projected.value).toBeCloseTo(value)
        expect(JSON.stringify(raw)).toBe(before)
      }
    }
  })
  test('custom PID/Mahony, out-of-range and missing fields stay explicit', () => {
    const raw = { ...ringControlPatch(anchors, 0, 5), mahony_kp_roll: 2.1 }
    expect(projectRingControl(anchors, 0, raw).custom).toBe(true)
    expect(projectRingControl(anchors, 0, { kp: 20 }).unavailable).toBe(true)
    expect(projectRingControl(anchors, 0, { ...raw, kp: Infinity }).unavailable).toBe(true)
    expect(projectRingControl(anchors, 2, { torquetilt_strength: 0.8 }).outOfRange).toBe(true)
    expect(projectRingControl(anchors, 7, { atr_strength_down: 0.5 }).value).toBe(2.5)
    expect(projectRingControl(anchors, 8, { atr_strength_up: 1.5 }).value).toBe(7.5)
  })
  test('presets own only active section fields; ATR never changes base speeds', () => {
    for (let section = 0; section < 3; section++) {
      const allowed = new Set(
        RING_CONTROLS.slice(section * 3, section * 3 + 3).flatMap((control) => [...control.fields]),
      )
      for (const preset of RING_PRESETS[section]) {
        const patch = ringSectionPatch(anchors, section, preset.values)
        expect(Object.keys(patch).every((id) => allowed.has(id as never))).toBe(true)
        expect(patch.atr_on_speed).toBeUndefined()
        expect(patch.atr_off_speed).toBeUndefined()
      }
    }
  })
  test('response direction and independence', () => {
    const low = ringControlPatch(anchors, 3, 0)
    const high = ringControlPatch(anchors, 3, 10)
    expect(high.turntilt_speed).toBeGreaterThan(low.turntilt_speed)
    expect(high.braketilt_lingering).toBeLessThan(low.braketilt_lingering)
    expect(Object.keys(ringControlPatch(anchors, 6, 10))).toEqual(['atr_response_boost'])
  })
})

test('board knowledge distinguishes mismatch from unknown and respects firmware precision', () => {
  expect(draftBoardState({ kp: 20 }, { kp: 20 }, false)).toBe('unknown')
  expect(draftBoardState({ kp: 20 }, {}, true)).toBe('unknown')
  expect(draftBoardState({ kp: 20 }, { kp: 21 }, true)).toBe('different')
  expect(draftBoardState({ ki: 0.026 }, { ki: Math.fround(0.026) }, true)).toBe('match')
  expect(draftBoardState({ ki: 0.0261 }, { ki: 0.0262 }, true)).toBe('different')
})

test('mix and resize stop the whole circle at first limit, preserving axis geometry', () => {
  const initial = handleCircle([50, 50, 50], 160, 200)
  expect(constrainCircleEdit(initial, initial, 160, 200, [1, 1, 1], 0)?.slice(0, 3)).toEqual([
    50, 50, 50,
  ])
  const resized = constrainCircleEdit(
    initial,
    { ...initial, r: initial.r + 500 },
    160,
    200,
    [1, 1, 1],
    0,
  )!
  expect(resized.slice(0, 3)).toEqual([100, 100, 100])
  const translated = constrainCircleEdit(
    initial,
    { ...initial, cx: initial.cx + 500 },
    160,
    200,
    [1, 1, 1],
    0,
  )!
  expect(translated[1]).toBe(0)
  expect(translated[2]).toBeLessThan(100)
  expect(translated[0]).toBeLessThan(50)
})

test('scaled native precision survives board confirmation and compound read-only projection', () => {
  const scales = { kp: 10, kp2: 100, ki: 100000, mahony_kp: 10000, mahony_kp_roll: 10000 }
  const intended = ringControlPatch(anchors, 0, 0.1)
  const readback = Object.fromEntries(
    Object.entries(intended).map(([id, value]) => [
      id,
      Math.floor(value * scales[id as keyof typeof scales] + 0.5) /
        scales[id as keyof typeof scales],
    ]),
  )
  expect(draftBoardState(intended, readback, true, scales)).toBe('match')
  const projection = projectRingControl(anchors, 0, readback, scales)
  expect(projection.value).toBe(0.1)
  expect(projection.custom).toBe(false)
  expect(readback).not.toEqual(intended)
})

test('half-step board equality uses native multiplication and half-up rounding', () => {
  expect(draftBoardState({ kp: 15.45 }, { kp: 15.5 }, true, { kp: 10 })).toBe('match')
  expect(draftBoardState({ kp: 15.45 }, { kp: 15.4 }, true, { kp: 10 })).toBe('different')
})

test('explicit mapped edits quantize only owned fields when native precision is available', () => {
  const patch = ringControlPatch(anchors, 0, 0.3, {
    kp: 10,
    kp2: 100,
    ki: 100000,
    mahony_kp: 10000,
    mahony_kp_roll: 10000,
  })
  expect(patch.kp).toBe(15.5)
  expect(patch.ki).toBe(0.01545)
  expect(patch.atr_strength_up).toBeUndefined()
  expect(patch.torquetilt_strength).toBeUndefined()
})
