import { describe, expect, test } from 'bun:test'
import { createTiltPresentationOwner, sampleTiltPresentation } from './remoteTiltPresentation'

const holding = { phase: 'holding' as const, value: 230 }
const decay = (elapsedMs: number) => ({
  phase: 'decaying' as const,
  value: 230 - Math.round((102 * elapsedMs) / 1000),
  decay: { totalMs: 1000, elapsedMs },
})

describe('Remote Tilt presentation ownership', () => {
  test('late holding and idle snapshots cannot take finger or pending release', () => {
    const owner = createTiltPresentationOwner()
    owner.begin()
    expect(owner.refresh(null)).toBeNull()
    const release = owner.pending()
    expect(owner.refresh(holding)).toBeNull()
    expect(owner.refresh(null)).toBeNull()
    expect(owner.accept(release, decay(0))?.phase).toBe('decaying')
  })

  test('new gesture rejects previous release acknowledgement', () => {
    const owner = createTiltPresentationOwner()
    owner.begin()
    const release = owner.pending()
    owner.begin()
    expect(owner.accept(release, decay(100))).toBeNull()
    expect(owner.refresh(decay(200))).toBeNull()
  })

  test('telemetry cadence cannot restart the countdown or rewind thumb', () => {
    const owner = createTiltPresentationOwner()
    const initial = owner.refresh(decay(0))!
    expect(owner.refresh(decay(100))).toBeNull()
    expect(owner.refresh(decay(100))).toBeNull()
    expect(owner.refresh(decay(800))).toBeNull()
    expect(sampleTiltPresentation(initial, 0.5)).toEqual({ value: 179, remainingMs: 500 })
    expect(sampleTiltPresentation(initial, 1)).toEqual({ value: 128, remainingMs: 0 })
    expect(owner.refresh(null)?.phase).toBe('idle')
  })

  test('cancel acknowledgement starts a new ramp even during release', () => {
    const owner = createTiltPresentationOwner()
    owner.refresh(decay(0))
    const cancel = owner.pending()
    expect(owner.refresh(decay(100))).toBeNull()
    expect(
      owner.accept(cancel, {
        phase: 'decaying',
        value: 180,
        decay: { totalMs: 200, elapsedMs: 0 },
      }),
    ).toEqual({ phase: 'decaying', value: 180, durationMs: 200 })
  })

  test('disconnect invalidates pending completions', () => {
    const owner = createTiltPresentationOwner()
    const release = owner.pending()
    owner.invalidate()
    expect(owner.accept(release, decay(0))).toBeNull()
    expect(owner.refresh(null)?.phase).toBe('idle')
  })
})

test('read begun before release cannot overwrite acknowledged ramp', () => {
  const owner = createTiltPresentationOwner()
  const oldRead = owner.readToken()!
  const release = owner.pending()
  owner.accept(release, decay(0))
  expect(owner.refresh(holding, oldRead)).toBeNull()
})

test('old failed read cannot revoke a newer finger gesture', () => {
  const owner = createTiltPresentationOwner()
  const release = owner.pending()
  owner.begin()
  expect(owner.fail(release)).toBe(false)
  expect(owner.refresh(null)).toBeNull()
})
