import { describe, expect, it } from 'bun:test'
import type { BmsEvent, BmsSeriesFrame } from 'vescape-core'

import {
  cellBarScale,
  nearestBmsFrameAtTime,
  summarizeBms,
  summarizeBmsWindow,
} from '@/modules/battery/lib/bms'

function makeBms(cellVoltages: number[], balancing: boolean[] = []): BmsEvent {
  return {
    capturedAt: 1000,
    voltageTotal: cellVoltages.reduce((s, v) => s + v, 0),
    vCharge: 0,
    current: 0,
    currentIc: 0,
    ampHours: 0,
    wattHours: 0,
    soc: null,
    soh: null,
    cellVoltages,
    balancing,
    temps: [],
    tempIc: null,
    tempHum: null,
    hum: null,
    tempMaxCell: null,
    canId: null,
  }
}

function makeFrame(capturedAt: number, cellVoltages: number[]): BmsSeriesFrame {
  return { capturedAt, cellVoltages, balancing: [] }
}

describe('summarizeBms', () => {
  it('returns null without usable cells', () => {
    expect(summarizeBms(null)).toBeNull()
    expect(summarizeBms(makeBms([]))).toBeNull()
    expect(summarizeBms(makeBms([0, 0]))).toBeNull()
  })

  it('computes min, max, spread and average across groups', () => {
    const summary = summarizeBms(makeBms([3.9, 4.1, 4.0]))
    expect(summary).not.toBeNull()
    expect(summary!.cellCount).toBe(3)
    expect(summary!.minVoltage).toBeCloseTo(3.9)
    expect(summary!.maxVoltage).toBeCloseTo(4.1)
    expect(summary!.spread).toBeCloseTo(0.2)
    expect(summary!.average).toBeCloseTo(4.0)
  })

  it('tags the lowest and highest groups when imbalanced', () => {
    const summary = summarizeBms(makeBms([3.9, 4.1, 4.0]))!
    expect(summary.groups[0].extreme).toBe('min')
    expect(summary.groups[1].extreme).toBe('max')
    expect(summary.groups[2].extreme).toBeNull()
  })

  it('tags no extremes when the pack is balanced', () => {
    const summary = summarizeBms(makeBms([4.0, 4.0, 4.0]))!
    expect(summary.spread).toBeCloseTo(0)
    expect(summary.groups.every((g) => g.extreme === null)).toBe(true)
  })

  it('carries the balancing flag per group, defaulting missing flags to false', () => {
    const summary = summarizeBms(makeBms([3.9, 4.1], [false, true]))!
    expect(summary.groups[0].balancing).toBe(false)
    expect(summary.groups[1].balancing).toBe(true)

    const noFlags = summarizeBms(makeBms([3.9, 4.1]))!
    expect(noFlags.groups.every((g) => !g.balancing)).toBe(true)
  })

  it('ignores zero/garbage cells when computing extremes but keeps them as rows', () => {
    const summary = summarizeBms(makeBms([4.0, 0, 3.8]))!
    expect(summary.cellCount).toBe(2)
    expect(summary.minVoltage).toBeCloseTo(3.8)
    expect(summary.maxVoltage).toBeCloseTo(4.0)
    expect(summary.groups).toHaveLength(3)
  })
})

describe('cellBarScale', () => {
  it('pads the pack min/max and snaps outward to the stability grid', () => {
    const scale = cellBarScale(3.9, 4.1)
    expect(scale.low).toBeCloseTo(3.88)
    expect(scale.high).toBeCloseTo(4.12)
  })

  it('floors the span for a balanced pack instead of dividing by zero', () => {
    const scale = cellBarScale(4.0, 4.0)
    expect(scale.high - scale.low).toBeCloseTo(0.12)
    expect((scale.low + scale.high) / 2).toBeCloseTo(4.0)
  })

  it('widens a barely-imbalanced pack to the floor span around its midpoint', () => {
    const scale = cellBarScale(3.99, 4.01)
    expect(scale.high - scale.low).toBeCloseTo(0.12)
    expect((scale.low + scale.high) / 2).toBeCloseTo(4.0)
  })

  it('holds bounds still under mV-level wiggle away from grid crossings', () => {
    const a = cellBarScale(3.951, 3.956)
    const b = cellBarScale(3.952, 3.957)
    expect(a.low).toBeCloseTo(b.low)
    expect(a.high).toBeCloseTo(b.high)
  })
})

describe('nearestBmsFrameAtTime', () => {
  const frames = [makeFrame(1000, [4]), makeFrame(1200, [3.9]), makeFrame(1600, [3.8])]

  it('returns the nearest retained frame without interpolation', () => {
    expect(nearestBmsFrameAtTime(frames, 1180)).toBe(frames[1])
    expect(nearestBmsFrameAtTime(frames, 1450)).toBe(frames[2])
  })

  it('clamps outside the retained window and chooses previous on exact ties', () => {
    expect(nearestBmsFrameAtTime(frames, 0)).toBe(frames[0])
    expect(nearestBmsFrameAtTime(frames, 3000)).toBe(frames[2])
    expect(nearestBmsFrameAtTime(frames, 1100)).toBe(frames[0])
  })

  it('returns null without a cursor or frames', () => {
    expect(nearestBmsFrameAtTime(frames, null)).toBeNull()
    expect(nearestBmsFrameAtTime([], 1000)).toBeNull()
  })
})

describe('summarizeBmsWindow', () => {
  it('reports peak spread and the group lowest most often', () => {
    const stats = summarizeBmsWindow([
      makeFrame(1000, [4.0, 4.03, 4.02]),
      makeFrame(1200, [3.98, 4.03, 4.02]),
      makeFrame(1400, [4.02, 4.01, 4.04]),
    ])

    expect(stats).not.toBeNull()
    expect(stats!.sampleCount).toBe(3)
    expect(stats!.peakSpread).toBeCloseTo(0.05)
    expect(stats!.worstGroupIndex).toBe(0)
    expect(stats!.worstGroupSamples).toBe(2)
  })

  it('uses depth below average to break lowest-group count ties', () => {
    const stats = summarizeBmsWindow([
      makeFrame(1000, [3.9, 4.0, 4.0]),
      makeFrame(1200, [4.0, 3.7, 4.0]),
    ])

    expect(stats!.worstGroupIndex).toBe(1)
    expect(stats!.worstGroupSamples).toBe(1)
    expect(stats!.worstGroupDepth).toBeGreaterThan(0.1)
  })

  it('keeps balanced windows from inventing a worst group', () => {
    const stats = summarizeBmsWindow([makeFrame(1000, [4.0, 4.0, 4.0])])

    expect(stats).not.toBeNull()
    expect(stats!.peakSpread).toBeCloseTo(0)
    expect(stats!.worstGroupIndex).toBeNull()
  })

  it('returns null when no frame has usable cell voltages', () => {
    expect(summarizeBmsWindow([makeFrame(1000, [0, Number.NaN])])).toBeNull()
  })
})
