import { describe, expect, it } from 'bun:test'
import type { VescFaultOccurrence } from 'vescape-core'

import { faultTitle, indicatorFaults } from '@/modules/board/lib/vescFaults'

function fault(over: Partial<VescFaultOccurrence>): VescFaultOccurrence {
  return {
    id: 'a',
    boardId: 'board',
    code: 9,
    occurredAtMs: 1_000,
    lastObservedAtMs: 1_000,
    clearedAtMs: null,
    dismissed: false,
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
})

describe('indicatorFaults', () => {
  it('keeps new live occurrences', () => {
    expect(indicatorFaults([fault({})]).map((f) => f.id)).toEqual(['a'])
  })

  it('drops dismissed occurrences without dropping them from history', () => {
    expect(indicatorFaults([fault({ dismissed: true })])).toEqual([])
  })

  it('keeps a cleared occurrence until it is dismissed', () => {
    expect(indicatorFaults([fault({ clearedAtMs: 2_000 })]).map((f) => f.id)).toEqual(['a'])
  })
})
