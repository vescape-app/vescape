import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '../../../..')

/**
 * The ride summary notification (#410) deep-links by recording id. Native mints the URL and Expo
 * Router resolves it, so the two halves are only correct together — renaming the route or the
 * native template silently breaks every summary tap. This asserts the contract instead.
 */
describe('ride summary deep link', () => {
  const route = 'src/app/history/ride/[rideId].tsx'
  const prefix = 'vescape://history/ride/'

  test('the route the notification opens exists', () => {
    expect(existsSync(join(repoRoot, route))).toBe(true)
  })

  test.each([
    'modules/vescape-core/android/src/main/java/expo/modules/vescapecore/recording/RideSummary.kt',
    'modules/vescape-core/ios/recording/RideSummary.swift',
  ])('%s mints that exact URL and points back at the route', (source) => {
    const text = readFileSync(join(repoRoot, source), 'utf8')
    expect(text).toContain(prefix)
    expect(text).toContain(`@parity /${route}`)
  })
})
