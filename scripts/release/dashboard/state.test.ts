import { describe, expect, test } from 'bun:test'
import type { ProductionManifest } from '../contracts'
import { productionRow, relativeAge, truncationAlerts } from './state'

const productionManifest = (
  overrides: Partial<ProductionManifest['phone']> = {},
): ProductionManifest => ({
  schemaVersion: 1,
  requestId: '00000000-0000-4000-8000-000000000000',
  openPromotionRunId: 9,
  sourceSha: 'a'.repeat(40),
  marketingVersion: '1.7.1',
  operation: 'promote',
  phone: {
    versionCode: 1388,
    sourceTrack: 'beta',
    targetTrack: 'production',
    status: 'promoted',
    playStatus: 'completed',
    ...overrides,
  },
  wear: {
    versionCode: 1389,
    sourceTrack: 'wear:beta',
    targetTrack: 'wear:production',
    status: 'promoted',
    playStatus: 'completed',
  },
  githubRelease: 'released',
})

describe('productionRow', () => {
  test('carries the exact artifact pair a status refresh must target', () => {
    const row = productionRow(productionManifest(), 11)

    expect(row).toMatchObject({
      marketingVersion: '1.7.1',
      phone: 1388,
      wear: 1389,
      detail: 'promoted',
      openPromotionRunId: 9,
    })
  })
})

describe('relativeAge', () => {
  const now = Date.parse('2026-08-01T12:00:00Z')

  test('reports minutes under an hour', () => {
    expect(relativeAge('2026-08-01T11:30:00Z', now)).toBe('30m ago')
  })

  test('reports hours up to two days', () => {
    expect(relativeAge('2026-07-31T12:00:00Z', now)).toBe('24h ago')
  })

  test('reports days beyond two days', () => {
    expect(relativeAge('2026-07-25T12:00:00Z', now)).toBe('7d ago')
  })

  test('returns null for a missing or unparseable timestamp', () => {
    expect(relativeAge(null, now)).toBeNull()
    expect(relativeAge('not-a-date', now)).toBeNull()
  })
})

describe('truncationAlerts', () => {
  test('names only the truncated scans', () => {
    expect(
      truncationAlerts([
        ['Internal', false],
        ['Production', true],
      ]),
    ).toEqual([
      'Production history scan found no readable successful release within the scan window; state shown may be incomplete',
    ])
  })
})
