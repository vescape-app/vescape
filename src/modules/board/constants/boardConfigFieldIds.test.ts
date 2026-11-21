import { describe, expect, test } from 'bun:test'
import { inflateSync } from 'node:zlib'

/**
 * @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/BoardConfigFieldsTest.kt
 * @parity /modules/vescape-core/ios/config/BoardConfigFieldsTests.swift
 */
const VERSIONS = ['1.0.0', '1.1.x', '1.2.x', '1.3.0-beta1']

const KNOWN_ABSENT: Record<string, string[]> = {
  '1.0.0': ['enable_quickstop'],
  '1.1.x': ['enable_quickstop'],
  '1.2.x': [],
  '1.3.0-beta1': [
    'atr_off_speed',
    'atr_on_speed',
    'atr_response_boost',
    'atr_transition_boost',
    'torquetilt_off_speed',
    'torquetilt_on_speed',
    'turntilt_speed',
  ],
}

const REPO_ROOT = `${import.meta.dir}/../../../..`

async function refloatFieldIds(version: string): Promise<Set<string>> {
  const path = `${REPO_ROOT}/shared/fixtures/refloat-schema/settings-${version}.xml.zlib`
  const xml = inflateSync(Buffer.from(await Bun.file(path).arrayBuffer())).toString('utf8')
  const params = xml.slice(xml.indexOf('<Params>'), xml.indexOf('</Params>'))
  return new Set([...params.matchAll(/^ {8}<([A-Za-z0-9_.]+)>$/gm)].map((match) => match[1]!))
}

async function namedFieldIds(): Promise<string[]> {
  const source = await Bun.file(`${REPO_ROOT}/modules/vescape-core/src/index.ts`).text()
  const union = source.slice(source.indexOf('export type BoardConfigFieldId ='))
  return [...union.slice(0, union.indexOf('\n\n')).matchAll(/\| '([A-Za-z0-9_.]+)'/g)].map(
    (match) => match[1]!,
  )
}

describe('board config field ids', () => {
  test.each(VERSIONS)('names no unknown field in Refloat %s', async (version) => {
    const ids = await refloatFieldIds(version)
    const named = await namedFieldIds()
    expect(ids.size).toBeGreaterThan(100)
    expect(named.length).toBeGreaterThan(50)
    expect(named.filter((id) => !ids.has(id)).sort()).toEqual([...KNOWN_ABSENT[version]!].sort())
  })

  test('every named field exists in at least one supported firmware', async () => {
    const everywhere = new Set(
      (await Promise.all(VERSIONS.map(refloatFieldIds))).flatMap((ids) => [...ids]),
    )
    expect((await namedFieldIds()).filter((id) => !everywhere.has(id))).toEqual([])
  })
})
