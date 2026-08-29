import { describe, expect, it } from 'bun:test'
import type { VescFaultOccurrence } from 'vescape-core'

import { faultTitle, indicatorFaults } from '@/modules/board/lib/vescFaults'

function fault(over: Partial<VescFaultOccurrence>): VescFaultOccurrence {
  return {
    id: 'a',
    boardId: 'board',
    code: 9,
    source: 'live',
    occurredAtMs: 1_000,
    discoveredAtMs: 1_000,
    lastObservedAtMs: 1_000,
    clearedAtMs: null,
    registerPosition: null,
    dismissed: false,
    registerSnapshotId: null,
    ...over,
  }
}

describe('faultTitle', () => {
  it('names known Refloat codes', () => {
    expect(faultTitle(9)).toBe('Both footpad zones off')
  })

  it('falls back to the raw code for firmware this build does not know', () => {
    expect(faultTitle(247)).toBe('Fault code 247')
  })

  it('reads a register occurrence in the controller code space, not the Refloat one', () => {
    expect(faultTitle(6, 'register')).toBe('Motor over temperature')
    expect(faultTitle(6, 'live')).toBe('Pitch angle exceeded')
  })

  it('names a register entry whose firmware fault name this build does not know', () => {
    expect(faultTitle(-1, 'baseline')).toBe('Unknown controller fault')
    expect(faultTitle(247, 'baseline')).toBe('Controller fault code 247')
  })
})

describe('indicatorFaults', () => {
  it('keeps new live occurrences', () => {
    expect(indicatorFaults([fault({})]).map((f) => f.id)).toEqual(['a'])
  })

  it('drops dismissed occurrences without dropping them from history', () => {
    expect(indicatorFaults([fault({ dismissed: true })])).toEqual([])
  })

  it('never lets a link-time baseline look like a new incident', () => {
    expect(indicatorFaults([fault({ source: 'baseline', occurredAtMs: null })])).toEqual([])
  })

  it('keeps a cleared occurrence until it is dismissed', () => {
    expect(indicatorFaults([fault({ clearedAtMs: 2_000 })]).map((f) => f.id)).toEqual(['a'])
  })
})
