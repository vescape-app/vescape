import { describe, expect, test } from 'bun:test'
import type { ReleaseManifest } from './contracts'
import {
  parseHistoricalReleaseManifest,
  parsePromotionManifest,
  parseProductionManifest,
  parseReleaseManifest,
  productionSummary,
  promotionSummary,
  releaseOutcome,
} from './contracts'

const manifest = (
  phone: 'succeeded' | 'failed',
  wear: 'succeeded' | 'failed',
): ReleaseManifest => ({
  schemaVersion: 1,
  requestId: '7f787fe8-4a30-4fcf-a3b1-4a9dd8606e38',
  sourceSha: 'a'.repeat(40),
  marketingVersion: '0.83.1',
  versionCodes: { phone: 100_000_042, wear: 1_100_000_042 },
  workflow: { runId: 123, runUrl: 'https://example.test/run/123', runAttempt: 1 },
  storageContracts: {
    sourceSha: 'a'.repeat(40),
    androidRoom: 'passed',
    iosGrdb: 'passed',
    crossPlatformArchives: 'passed',
  },
  artifacts: {
    phone: { name: 'app-release.aab', sha256: 'a', signingCertificateSha256: 'c' },
    wear: { name: 'wearos-release.aab', sha256: 'b', signingCertificateSha256: 'c' },
  },
  uploads: { phone, wear },
})

describe('open promotion manifest', () => {
  const promotion = {
    schemaVersion: 1 as const,
    requestId: '7f787fe8-4a30-4fcf-a3b1-4a9dd8606e38',
    candidateRunId: 123,
    sourceSha: 'a'.repeat(40),
    marketingVersion: '0.83.1',
    phone: {
      versionCode: 100_000_042,
      sourceTrack: 'internal',
      targetTrack: 'beta',
      status: 'already-open' as const,
    },
    wear: {
      versionCode: 1_100_000_042,
      sourceTrack: 'wear:internal',
      targetTrack: 'wear:beta',
      status: 'promoted' as const,
    },
  }

  test('parses exact per-form-factor state', () => {
    expect(parsePromotionManifest(promotion)).toEqual(promotion)
    expect(() => parsePromotionManifest({ ...promotion, candidateRunId: 0 })).toThrow(
      'invalid shape',
    )
  })

  test('renders partial retry convergence', () => {
    expect(promotionSummary(promotion)).toBe(
      'phone 100000042: already-open · Wear 1100000042: promoted',
    )
  })
})

describe('release manifest', () => {
  test('reads historical uploads without allowing unattested builds through promotion validation', () => {
    const { storageContracts: _, ...historical } = manifest('succeeded', 'succeeded')
    expect(parseHistoricalReleaseManifest(historical)).toEqual(historical)
    expect(() => parseReleaseManifest(historical)).toThrow('invalid shape')
    expect(() =>
      parseHistoricalReleaseManifest({
        ...historical,
        uploads: { phone: 'unknown', wear: 'succeeded' },
      }),
    ).toThrow('invalid shape')
  })

  test('parses the workflow contract', () => {
    const valid = manifest('succeeded', 'succeeded')
    expect(parseReleaseManifest(valid).sourceSha).toBe('a'.repeat(40))
    expect(() => parseReleaseManifest({ ...valid, storageContracts: undefined })).toThrow(
      'invalid shape',
    )
    expect(() =>
      parseReleaseManifest({
        ...valid,
        storageContracts: { ...valid.storageContracts, sourceSha: 'b'.repeat(40) },
      }),
    ).toThrow('invalid shape')
    expect(() => parseReleaseManifest({ schemaVersion: 2 })).toThrow('invalid shape')
  })

  test('reports a partial upload explicitly', () => {
    expect(releaseOutcome(manifest('succeeded', 'failed'))).toEqual({
      kind: 'partial',
      succeeded: 'phone',
      failed: 'wear',
    })
  })
})

describe('production manifest', () => {
  const production = {
    schemaVersion: 1 as const,
    requestId: crypto.randomUUID(),
    openPromotionRunId: 304,
    sourceSha: 'a'.repeat(40),
    marketingVersion: '0.83.1',
    operation: 'promote' as const,
    phone: {
      versionCode: 100_000_042,
      sourceTrack: 'beta',
      targetTrack: 'production',
      status: 'promoted' as const,
      playStatus: 'completed',
    },
    wear: {
      versionCode: 1_100_000_042,
      sourceTrack: 'wear:beta',
      targetTrack: 'wear:production',
      status: 'already-production' as const,
      playStatus: 'completed',
    },
    githubRelease: 'released' as const,
  }

  test('parses exact production and GitHub state', () => {
    expect(parseProductionManifest(production)).toEqual(production)
    expect(() => parseProductionManifest({ ...production, operation: 'advance' })).toThrow(
      'invalid shape',
    )
  })

  test('renders partial retry state precisely', () => {
    expect(productionSummary(production)).toBe(
      'phone 100000042: promoted · Wear 1100000042: already-production · GitHub released',
    )
  })
})
