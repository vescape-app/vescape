import { describe, expect, test } from 'bun:test'
import { inflateSync } from 'node:zlib'

import { SPEED_CONFIG_ROWS } from '@/modules/board/constants/boardConfigRows'
import { BOARD_CONFIG_TABS } from '@/modules/board/constants/boardConfigTabs'
import {
  BOOST_DETAIL_ROWS,
  FOOTPAD_EXTRA_ROWS,
  PACKAGE_ROWS,
  SPEED_EXTRA_ROWS,
  TUNE_RESPONSE_ROWS,
} from '@/modules/board/constants/extraBoardConfigRows'
import { splitConfigGroups } from '@/modules/board/lib/splitConfigGroups'
import { boardConfigTabs } from './boardConfigGroups'

const versions = ['1.0.0', '1.1.x', '1.2.x', '1.3.0-beta1']

describe('Board config browsing', () => {
  test.each(versions)(
    'keeps every Refloat %s field reachable, including unfamiliar fields',
    async (version) => {
      const bytes = await Bun.file(
        `${import.meta.dir}/../../../shared/fixtures/refloat-schema/settings-${version}.xml.zlib`,
      ).arrayBuffer()
      const xml = inflateSync(Buffer.from(bytes)).toString('utf8')
      const params = xml.slice(xml.indexOf('<Params>'), xml.indexOf('</Params>'))
      const ids = [...params.matchAll(/^ {8}<([A-Za-z0-9_.]+)>$/gm)].map((match) => match[1]!)
      expect(ids.length).toBeGreaterThan(100)
      const values = Object.fromEntries([...ids, 'future_setting'].map((id) => [id, 0]))
      const tabs = boardConfigTabs(values)
      const allIds = new Set(
        tabs.flatMap((tab) =>
          tab.groups
            .filter((group) => group.source === 'refloat')
            .flatMap((group) => group.rows.map((row) => row.id)),
        ),
      )
      expect(Object.keys(values).filter((id) => !allIds.has(id))).toEqual([])
      const other = tabs.find((tab) => tab.id === 'other')!
      const remaining = other.groups.find((group) => group.title === 'Other board config')!.rows
      expect(remaining.some((row) => row.id === 'future_setting')).toBe(true)
      const tuneIds = new Set<string>(
        tabs
          .find((tab) => tab.id === 'tune')!
          .groups.flatMap((group) => group.rows.map((row) => row.id)),
      )
      expect(
        other.groups
          .filter((group) => group.source === 'refloat')
          .flatMap((group) => group.rows)
          .filter((row) => tuneIds.has(row.id)),
      ).toEqual([])
    },
  )

  test('uses shared labels, moves current limits to Battery, and separates Tune from controller setup', () => {
    const sampleTuneIds = [
      'kp',
      'kp2',
      'atr_strength_up',
      'turntilt_strength',
      'torquetilt_strength',
      'braketilt_strength',
      'tiltback_constant',
    ]
    const refloat = Object.fromEntries(sampleTuneIds.map((id) => [id, 0]))
    const tabs = boardConfigTabs(
      { ...refloat, future_setting: true },
      { l_in_current_max: 70, l_in_current_min: -45, foc_current_kp: 0.02 },
    )
    const speedRows = tabs.find((tab) => tab.id === 'speed')!.groups[0]!.rows
    expect(speedRows[0]).toBe(SPEED_CONFIG_ROWS[0])
    const tuneRows = tabs.find((tab) => tab.id === 'tune')!.groups.flatMap((group) => group.rows)
    expect(tuneRows.map((row) => row.id)).toEqual(sampleTuneIds)
    const battery = tabs.find((tab) => tab.id === 'battery')!
    expect(battery.groups.flatMap((group) => group.rows.map((row) => row.id))).toEqual([
      'l_in_current_max',
      'l_in_current_min',
    ])
    const motor = tabs.find((tab) => tab.id === 'motor')!
    expect(motor.groups.flatMap((group) => group.rows.map((row) => row.id))).toEqual([
      'l_in_current_max',
      'l_in_current_min',
      'foc_current_kp',
    ])
    const other = tabs.find((tab) => tab.id === 'other')!
    expect(other.groups.flatMap((group) => group.rows.map((row) => row.id))).toEqual([
      'future_setting',
    ])
  })

  test('large tabs collapse details without losing fields; small tabs stay fully visible', () => {
    const motorValues = {
      l_current_max: 100,
      l_current_min: -80,
      l_abs_current_max: 150,
      ...Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [`foc_detail_${index}`, index]),
      ),
    }
    const motor = boardConfigTabs(undefined, motorValues).find((tab) => tab.id === 'motor')!
    const split = splitConfigGroups(motor.groups)
    expect(split.advancedCount).toBe(20)
    expect(split.primary.flatMap((group) => group.rows.map((row) => row.id))).toEqual([
      'l_current_max',
      'l_current_min',
      'l_abs_current_max',
      'booster_current',
      'brkbooster_current',
    ])
    expect([...split.primary, ...split.advanced].flatMap((group) => group.rows).length).toBe(
      motor.groups.flatMap((group) => group.rows).length,
    )
    const footpad = boardConfigTabs().find((tab) => tab.id === 'footpad')!
    expect(splitConfigGroups(footpad.groups).advancedCount).toBe(0)
  })

  test.each(versions)(
    'known extra fields have readable labels and schema units in Refloat %s',
    async (version) => {
      const bytes = await Bun.file(
        `${import.meta.dir}/../../../shared/fixtures/refloat-schema/settings-${version}.xml.zlib`,
      ).arrayBuffer()
      const xml = inflateSync(Buffer.from(bytes)).toString('utf8')
      const rows = [
        ...BOOST_DETAIL_ROWS,
        ...FOOTPAD_EXTRA_ROWS,
        ...PACKAGE_ROWS,
        ...SPEED_EXTRA_ROWS,
        ...TUNE_RESPONSE_ROWS,
      ]
      const values: Record<string, number> = {}
      for (const row of rows) {
        const start = xml.indexOf(`<${row.id}>`)
        if (start < 0) continue
        values[row.id] = 1
        const field = xml.slice(start, xml.indexOf(`</${row.id}>`, start))
        expect(row.label).not.toBe(row.id)
        if (field.includes('<type>5</type>')) {
          expect(row.format(1)).toBe('On')
          expect(row.format(0)).toBe('Off')
        } else {
          const suffix = field.match(/<suffix>(.*?)<\/suffix>/)?.[1]?.trim()
          expect(suffix).toBeTruthy()
          expect(row.format(1).endsWith(suffix!)).toBe(true)
        }
      }
      const displayedRows = boardConfigTabs(values).flatMap((tab) =>
        tab.groups.flatMap((group) => group.rows),
      )
      for (const row of rows.filter((candidate) => candidate.id in values)) {
        expect(displayedRows.filter((candidate) => candidate.id === row.id)).toContain(row)
      }
    },
  )

  test('routes future flat and nested torque and turn tilt fields to Tune', () => {
    const ids = ['torquetilt_future', 'turntilt_future', 'torque_tilt.future', 'turn_tilt.future']
    const tabs = boardConfigTabs(Object.fromEntries(ids.map((id) => [id, 1])))
    expect(
      tabs
        .find((tab) => tab.id === 'tune')!
        .groups.flatMap((group) => group.rows.map((row) => row.id)),
    ).toEqual([...ids].sort())
  })

  test.each(versions)(
    'feedback, remote, and start/stop enums and percentage scaling match Refloat %s',
    async (version) => {
      const bytes = await Bun.file(
        `${import.meta.dir}/../../../shared/fixtures/refloat-schema/settings-${version}.xml.zlib`,
      ).arrayBuffer()
      const xml = inflateSync(Buffer.from(bytes)).toString('utf8')
      const rows = BOARD_CONFIG_TABS.filter((tab) =>
        ['haptic', 'remote', 'start-stop'].includes(tab.id),
      ).flatMap((tab) => tab.groups.flatMap((group) => group.rows))
      let checkedEnums = 0
      let checkedPercentages = 0
      for (const row of rows) {
        const start = xml.indexOf(`<${row.id}>`)
        if (start < 0) continue
        const field = xml.slice(start, xml.indexOf(`</${row.id}>`, start))
        const names = [...field.matchAll(/<enumNames>(.*?)<\/enumNames>/g)].map((match) =>
          match[1]!.replaceAll('&amp;', '&'),
        )
        names.forEach((name, index) => expect(row.format(index)).toBe(name))
        if (names.length) checkedEnums++
        if (/<suffix>\s*%<\/suffix>/.test(field)) {
          const scale =
            row.id === 'inputtilt_deadband'
              ? 100
              : Number(field.match(/<editorScale>(.*?)<\/editorScale>/)?.[1] ?? 1)
          expect(row.format(0.5)).toBe(`${Math.round(0.5 * scale)}%`)
          checkedPercentages++
        }
      }
      expect(checkedEnums).toBeGreaterThanOrEqual(1)
      expect(checkedPercentages).toBeGreaterThanOrEqual(1)
    },
  )
})
