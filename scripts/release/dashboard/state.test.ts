import { describe, expect, test } from 'bun:test'
import type { ProductionManifest } from '../contracts'
import {
  pendingCount,
  productionRow,
  relativeAge,
  truncationAlerts,
  unreleasedPrereleases,
} from './state'

const productionManifest = (
  overrides: Partial<ProductionManifest['phone']> = {},
): ProductionManifest => ({
  schemaVersion: 1,
  requestId: '00000000-0000-4000-8000-000000000000',
  openPromotionRunId: 9,
  sourceSha: 'a'.repeat(40),
  marketingVersion: '1.7.1',
  operation: 'promote',
  requestedRolloutPercentage: 25,
  phone: {
    versionCode: 1388,
    sourceTrack: 'beta',
    targetTrack: 'production',
    status: 'promoted',
    playStatus: 'inProgress',
    rolloutPercentage: 25,
    ...overrides,
  },
  wear: {
    versionCode: 1389,
    sourceTrack: 'wear:beta',
    targetTrack: 'wear:production',
    status: 'promoted',
    playStatus: 'inProgress',
    rolloutPercentage: 25,
  },
  githubRelease: 'released',
})

describe('pendingCount', () => {
  test('counts every run when the downstream track consumed nothing', () => {
    expect(
      pendingCount(
        [
          { runId: 3, createdAt: null },
          { runId: 2, createdAt: null },
        ],
        null,
      ),
    ).toBe(2)
  })

  test('counts only runs newer than the consumed one', () => {
    const runs = [
      { runId: 5, createdAt: null },
      { runId: 4, createdAt: null },
      { runId: 3, createdAt: null },
    ]
    expect(pendingCount(runs, 3)).toBe(2)
    expect(pendingCount(runs, 5)).toBe(0)
  })
})

describe('productionRow', () => {
  test('carries the recorded rollout percentage', () => {
    expect(productionRow(productionManifest(), 11).rolloutPercentage).toBe(25)
  })

  test('reads halted from the artifact status', () => {
    expect(productionRow(productionManifest({ status: 'halted' }), 11).halted).toBe(true)
  })

  test('reads halted from live Play status even when the operation succeeded', () => {
    expect(productionRow(productionManifest({ playStatus: 'halted' }), 11).halted).toBe(true)
  })
})

describe('unreleasedPrereleases', () => {
  test('drops the tag that already reached production', () => {
    expect(unreleasedPrereleases(['v1.8.0', 'v1.7.1'], '1.7.1')).toEqual(['v1.8.0'])
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
      'Production history is all failures within the scan window; state shown may be incomplete',
    ])
  })
})
