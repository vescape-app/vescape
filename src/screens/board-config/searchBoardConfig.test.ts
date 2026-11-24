import { describe, expect, test } from 'bun:test'

import { searchBoardConfig } from '@/modules/board/lib/searchBoardConfig'
import { REFLOAT_FIELD_OVERLAY } from '@/modules/board/lib/refloatFieldOverlay'
import { BOARD_CONFIG_TABS } from '@/modules/board/constants/boardConfigTabs'
import { boardConfigTabs } from './boardConfigGroups'

const allRefloat = Object.fromEntries(
  [
    ...BOARD_CONFIG_TABS.flatMap((tab) =>
      tab.groups.filter((group) => group.source === 'refloat').flatMap((group) => group.rows),
    ).map((row) => row.id),
    ...Object.keys(REFLOAT_FIELD_OVERLAY),
  ].map((id) => [id, 0]),
)
const allMotor = Object.fromEntries(
  BOARD_CONFIG_TABS.flatMap((tab) =>
    tab.groups.filter((group) => group.source === 'motor').flatMap((group) => group.rows),
  ).map((row) => [row.id, 0]),
)
const tabs = boardConfigTabs(allRefloat, allMotor)
const search = (query: string, sources: ('refloat' | 'motor')[] = ['refloat', 'motor']) =>
  searchBoardConfig(tabs, query, sources)
const ids = (query: string) => search(query).flatMap((group) => group.rows.map((row) => row.id))

describe('Board config search', () => {
  test('blank and unknown queries find nothing', () => {
    expect(search('')).toEqual([])
    expect(search('  - ')).toEqual([])
    expect(search('zzqx')).toEqual([])
  })

  test('ranks the exact label first and tolerates casing, punctuation and typos', () => {
    expect(ids('Push start')[0]).toBe('startup_pushstart_enabled')
    expect(ids('push-START!')[0]).toBe('startup_pushstart_enabled')
    expect(ids('dirty landing')[0]).toBe('startup_dirtylandings_enabled')
    expect(ids('dirty landign')[0]).toBe('startup_dirtylandings_enabled')
    expect(ids('brighness')).toContain('leds.front.brightness')
  })

  test('finds rows through hidden rider words absent from labels', () => {
    expect(ids('posi')[0]).toBe('fault_is_dual_switch')
    expect(ids('heel lift')).toContain('fault_is_dual_switch')
    expect(ids('moving faults')[0]).toBe('fault_moving_fault_disabled')
    expect(ids('sensor dropout')).toEqual(['fault_moving_fault_disabled'])
    expect(ids('jumps')).toContain('startup_dirtylandings_enabled')
    expect(ids('backwards dismount')[0]).toBe('fault_reversestop_enabled')
    expect(ids('pushback')).toContain('tiltback_duty')
    expect(ids('fet')).toEqual(['l_temp_fet_start', 'l_temp_fet_end'])
    expect(ids('led patterns')).toContain('leds.front.mode')
    expect(ids('gyro')).toContain('mahony_kp')
  })

  test('keeps motor and battery current apart', () => {
    expect(ids('battery regen')[0]).toBe('l_in_current_min')
    expect(ids('motor current')[0]).toBe('l_current_max')
    expect(ids('battery current')[0]).toBe('l_in_current_max')
  })

  test('requires every word to match instead of returning everything', () => {
    expect(ids('front brightness')).toContain('leds.front.brightness')
    expect(ids('front brightness')).not.toContain('leds.rear.brightness')
    expect(ids('e').length).toBeLessThan(5)
  })

  test('lists a duplicated field once, in its topic tab, but keeps sources apart', () => {
    const results = search('simple start')
    const rows = results.flatMap((group) => group.rows.map((row) => row.id))
    expect(rows.filter((id) => id === 'startup_simplestart_enabled')).toHaveLength(1)
    expect(results[0]!.tabId).toBe('start-stop')
    const shared = boardConfigTabs({ future_setting: 1 }, { future_setting: 2 })
    const both = searchBoardConfig(shared, 'future setting', ['refloat', 'motor'])
    expect(both.map((group) => group.source).sort()).toEqual(['motor', 'refloat'])
  })

  test('reaches hidden details, Tune, and raw firmware fields', () => {
    expect(ids('LED pin')[0]).toBe('hardware.leds.pin')
    expect(ids('angle p')[0]).toBe('kp')
    const raw = boardConfigTabs({ ...allRefloat, future_setting: 1 }, allMotor)
    expect(
      searchBoardConfig(raw, 'future', ['refloat']).flatMap((group) => group.rows.map((r) => r.id)),
    ).toEqual(['future_setting'])
  })

  test('only searches config that has been read', () => {
    expect(search('posi', ['motor'])).toEqual([])
    expect(search('fet', ['refloat'])).toEqual([])
  })

  test('orders results deterministically', () => {
    expect(ids('tiltback')).toEqual(ids('tiltback'))
  })
})
