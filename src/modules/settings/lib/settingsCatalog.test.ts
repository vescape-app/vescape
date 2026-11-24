import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { SETTINGS_EXTRA_GROUPS, SETTINGS_GROUPS, searchSettings } from './settingsCatalog'

const SETTINGS_FOCUS_FILES = [
  'app/settings/about.tsx',
  'app/settings/automation.tsx',
  'app/settings/database.tsx',
  'app/settings/diagnostics.tsx',
  'app/settings/graphs.tsx',
  'app/settings/history.tsx',
  'app/settings/live-telemetry.tsx',
  'app/settings/map.tsx',
  'app/settings/units.tsx',
  'app/settings/watch.tsx',
  'modules/settings/components/AutoStartCard.tsx',
  'modules/settings/screens/SoundsSettingsScreen.tsx',
]

function collectCodeFocusIds(): Set<string> {
  const root = join(import.meta.dir, '../../..')
  const ids = new Set<string>()
  for (const rel of SETTINGS_FOCUS_FILES) {
    const source = readFileSync(join(root, rel), 'utf8')
    for (const match of source.matchAll(/focusId=(?:"([^"]+)"|'([^']+)')/g)) {
      const id = match[1] ?? match[2]
      if (id) ids.add(id)
    }
    for (const match of source.matchAll(/useFocusTarget\((?:"([^"]+)"|'([^']+)')\)/g)) {
      const id = match[1] ?? match[2]
      if (id) ids.add(id)
    }
    for (const match of source.matchAll(/key:\s*'([^']+)',\s*label:/g)) {
      if (rel === 'app/settings/graphs.tsx' && match[1]) {
        ids.add(`hot-range-${match[1]}`)
      }
    }
  }
  return ids
}

describe('settingsCatalog', () => {
  test('every focusId in settings screens matches a catalog item and vice versa', () => {
    const codeIds = collectCodeFocusIds()
    const catalogIds = new Set(
      [...SETTINGS_GROUPS, ...SETTINGS_EXTRA_GROUPS].flatMap((group) =>
        group.sections.flatMap((section) =>
          section.items.filter((item) => !item.route).map((item) => item.id),
        ),
      ),
    )

    const missingInCatalog = [...codeIds].filter((id) => !catalogIds.has(id))
    const missingInCode = [...catalogIds].filter((id) => !codeIds.has(id))

    expect(missingInCatalog).toEqual([])
    expect(missingInCode).toEqual([])
  })

  test('finds settings by exact label, synonyms, typos, and nested items', () => {
    expect(searchSettings('Auto connect')[0]?.focus).toBe('auto-connect')
    expect(searchSettings('mph')[0]?.route).toBe('/settings/units')
    expect(searchSettings('fahrenheit')[0]?.focus).toBe('temperature')
    expect(searchSettings('satelite')[0]?.focus).toBe('satellite-overlay')
    expect(searchSettings('backup')[0]?.route).toBe('/settings/database')
    expect(searchSettings('privacy policy')[0]?.focus).toBe('privacy-policy')
    expect(searchSettings('tilt speed')[0]?.focus).toBe('watch-tilt-speed')
    expect(searchSettings('components library')[0]?.item?.route).toBe('/settings/components')
  })

  test('filters Android-only settings out on iOS and keeps them on Android', () => {
    expect(
      searchSettings('auto start app', 'android').some((hit) => hit.focus === 'auto-start'),
    ).toBe(true)
    expect(searchSettings('auto start app', 'ios').some((hit) => hit.focus === 'auto-start')).toBe(
      false,
    )
    expect(searchSettings('audio output', 'ios').some((hit) => hit.focus === 'audio-output')).toBe(
      false,
    )
    expect(
      searchSettings('audio output', 'android').some((hit) => hit.focus === 'audio-output'),
    ).toBe(true)
  })

  test('returns empty for blank or unknown queries', () => {
    expect(searchSettings('')).toEqual([])
    expect(searchSettings('   ')).toEqual([])
    expect(searchSettings('zzqx')).toEqual([])
  })
})
