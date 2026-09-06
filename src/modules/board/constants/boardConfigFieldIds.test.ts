import { describe, expect, test } from 'bun:test'
import { inflateSync } from 'node:zlib'

/**
 * Every id in `BoardConfigFieldId`, resolved against the real `settings.xml` of each supported
 * firmware — the same fixture corpus the native field sets are tested with.
 *
 * A mistyped id is a compile error now that config rows and Tune fields are typed by that union. A
 * correctly spelled id Refloat simply does not have still type-checks, and renders an em dash
 * forever: it reads as "the board has no value here" rather than as the bug it is. This test is what
 * makes that loud.
 *
 * The union is read from its source rather than imported, because a type does not exist at runtime —
 * and because every consumer is typed by it, checking the union covers all of them at once.
 *
 * @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/BoardConfigFieldsTest.kt
 * @parity /modules/vescape-core/ios/config/BoardConfigFieldsTests.swift
 */
const VERSIONS = ['1.0.0', '1.1.x', '1.2.x', '1.3.0-beta1']

/**
 * Fields a supported firmware genuinely does not have. Refloat adds and removes settings between
 * releases, so an id missing from one version is not automatically a bug — but it must be a *known*
 * absence, written down and reviewed, or a field silently vanishing in a future release looks exactly
 * like a field that was never there.
 *
 * - `enable_quickstop` arrived in Refloat 1.2.
 * - Refloat 1.3 dropped the ATR/torque-tilt/turn-tilt ramp speeds and the ATR response boosts.
 */
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

/**
 * The fixture's field ids. Refloat's schema is one element per field directly under `<Params>`, so
 * the ids are read off the document rather than through a parser this app does not otherwise need.
 */
async function refloatFieldIds(version: string): Promise<Set<string>> {
  const path = `${REPO_ROOT}/shared/fixtures/refloat-schema/settings-${version}.xml.zlib`
  const xml = inflateSync(Buffer.from(await Bun.file(path).arrayBuffer())).toString('utf8')
  const params = xml.slice(xml.indexOf('<Params>'), xml.indexOf('</Params>'))
  return new Set([...params.matchAll(/^ {8}<([A-Za-z0-9_.]+)>$/gm)].map((match) => match[1]!))
}

/** The `BoardConfigFieldId` members, read off the bridge type declaration. */
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
    // Guards the readers themselves: a regex that stopped matching would pass every id vacuously.
    expect(ids.size).toBeGreaterThan(100)
    expect(named.length).toBeGreaterThan(50)
    expect(named.filter((id) => !ids.has(id)).sort()).toEqual([...KNOWN_ABSENT[version]!].sort())
  })

  /** An id no supported firmware has is dead weight: a typo, or a setting Refloat has retired. */
  test('every named field exists in at least one supported firmware', async () => {
    const everywhere = new Set(
      (await Promise.all(VERSIONS.map(refloatFieldIds))).flatMap((ids) => [...ids]),
    )
    expect((await namedFieldIds()).filter((id) => !everywhere.has(id))).toEqual([])
  })
})
