import { describe, expect, test } from 'bun:test'
import type { BoardWarning } from 'vescape-core'

import { parseWarningDetail, warningTitle, worstSeverity } from '@/modules/board/lib/boardWarnings'

function warning(overrides: Partial<BoardWarning>): BoardWarning {
  return {
    boardId: 'board-a',
    kind: 'cell-spread',
    severity: 'warn',
    firstDetectedAtMs: 0,
    lastDetectedAtMs: 0,
    payloadJson: '{}',
    ...overrides,
  }
}

describe('worstSeverity', () => {
  test('returns null when there are no warnings', () => {
    expect(worstSeverity([])).toBeNull()
  })

  test('returns warn when only warn-level warnings exist', () => {
    expect(worstSeverity([warning({ severity: 'warn' }), warning({ severity: 'warn' })])).toBe(
      'warn',
    )
  })

  test('critical dominates regardless of order', () => {
    expect(worstSeverity([warning({ severity: 'warn' }), warning({ severity: 'critical' })])).toBe(
      'critical',
    )
  })
})

describe('warningTitle', () => {
  test('maps known kinds to rider-facing titles', () => {
    expect(warningTitle('footpad-disabled')).toBe('Footpad sensor disabled')
  })

  test('falls back to the raw kind for unknown detectors', () => {
    expect(warningTitle('some-future-kind')).toBe('some-future-kind')
  })
})

describe('parseWarningDetail', () => {
  test('returns [] for invalid JSON', () => {
    expect(parseWarningDetail('cell-spread', 'not json')).toEqual([])
  })

  test('returns [] for non-object payloads', () => {
    expect(parseWarningDetail('cell-spread', '42')).toEqual([])
    expect(parseWarningDetail('cell-spread', '[1,2]')).toEqual([])
  })

  test('humanizes keys and formats values for generic kinds', () => {
    expect(
      parseWarningDetail('cell-spread', '{"peakSpread":0.27,"worstGroup":4,"balancing":true}'),
    ).toEqual([
      { label: 'Peak Spread', value: '0.270' },
      { label: 'Worst Group', value: '4' },
      { label: 'Balancing', value: 'yes' },
    ])
  })

  test('renders voltage pushback kinds as unit-labelled current vs safe limit', () => {
    expect(
      parseWarningDetail('hv-pushback-high', '{"param":"tiltback_hv","value":86,"bound":86.9}'),
    ).toEqual([
      { label: 'Current value', value: '86 V' },
      { label: 'Safe maximum', value: '86.9 V' },
    ])
    expect(
      parseWarningDetail('lv-pushback-low', '{"param":"tiltback_lv","value":2.8,"bound":3}'),
    ).toEqual([
      { label: 'Current value', value: '2.8 V' },
      { label: 'Safe minimum', value: '3 V' },
    ])
  })

  test('renders duty pushback as percent', () => {
    expect(
      parseWarningDetail('duty-pushback-high', '{"param":"tiltback_duty","value":1,"bound":0.85}'),
    ).toEqual([
      { label: 'Current value', value: '100%' },
      { label: 'Safe maximum', value: '85%' },
    ])
  })

  test('the footpad config kind renders no numeric rows', () => {
    expect(
      parseWarningDetail(
        'footpad-disabled',
        '{"param":"fault_adc1/fault_adc2","value":1,"bound":0}',
      ),
    ).toEqual([])
  })

  test('config kind with malformed payload renders no rows', () => {
    expect(parseWarningDetail('hv-pushback-high', '{"param":"tiltback_hv"}')).toEqual([])
  })
})
