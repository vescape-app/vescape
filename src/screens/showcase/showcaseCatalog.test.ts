import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { SHOWCASE_GROUPS, searchShowcase } from './showcaseCatalog'

function walkTsx(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walkTsx(full))
    else if (full.endsWith('.tsx')) files.push(full)
  }
  return files
}

describe('showcaseCatalog', () => {
  test('every literal ShowcaseCard name in the repo is indexed in SHOWCASE_GROUPS', () => {
    const indexedNames = new Set(
      SHOWCASE_GROUPS.flatMap((group) =>
        group.sections.flatMap((section) => section.items.map((item) => item.label)),
      ),
    )
    const root = join(import.meta.dir, '../..')
    const dirs = [join(root, 'app/settings/components'), join(root, 'screens/showcase')]
    const missing: string[] = []

    for (const dir of dirs) {
      for (const file of walkTsx(dir)) {
        const source = readFileSync(file, 'utf8')
        for (const match of source.matchAll(/<ShowcaseCard[\s\S]*?name=(?:"([^"]+)"|'([^']+)')/g)) {
          const name = match[1] ?? match[2]
          if (name && !indexedNames.has(name)) {
            missing.push(`${name} (${file})`)
          }
        }
      }
    }

    expect(missing).toEqual([])
  })

  test('finds components by exact name, split PascalCase words, typos, and keywords', () => {
    expect(searchShowcase('SearchInput')[0]?.label).toBe('SearchInput')
    expect(searchShowcase('search input')[0]?.label).toBe('SearchInput')
    expect(searchShowcase('search input')[0]?.focus).toBe('SearchInput')
    expect(searchShowcase('sparklne')[0]?.label).toBe('Sparkline')
    expect(searchShowcase('empty state')[0]?.label).toBe('Placeholder')
    expect(
      searchShowcase('bottom sheet').some((hit) => hit.route === '/settings/components/drawers'),
    ).toBe(true)
  })

  test('ranks matching category sections first and returns empty for blank or unknown queries', () => {
    const forms = searchShowcase('Forms')
    expect(forms[0]?.kind).toBe('section')
    expect(forms[0]?.route).toBe('/settings/components/forms')

    expect(searchShowcase('')).toEqual([])
    expect(searchShowcase('   ')).toEqual([])
    expect(searchShowcase('zzqx')).toEqual([])
  })
})
