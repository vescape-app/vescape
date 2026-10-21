import { describe, expect, it } from 'bun:test'
import type { VescFaultOccurrence } from 'vescape-core'

import { faultInfo, indicatorFaults } from '@/modules/board/lib/vescFaults'

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

describe('faultInfo', () => {
  it('names controller faults by mc_fault_code, not Refloat riding states', () => {
    expect([2, 4, 6, 7, 8, 9, 10].map((code) => faultInfo(code).title)).toEqual([
      'Under voltage',
      'Absolute over current',
      'Motor overtemperature',
      'Gate driver overvoltage',
      'Gate driver undervoltage',
      'MCU undervoltage',
      'Watchdog reset',
    ])
  })

  it('keeps the number and admits it for codes this build does not know', () => {
    expect(faultInfo(247)).toEqual({
      title: 'Fault code 247',
      description: 'The controller reported a fault this app does not yet recognize.',
    })
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
