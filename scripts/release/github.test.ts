import { describe, expect, test } from 'bun:test'
import {
  createDispatchPayload,
  createPromotionDispatchPayload,
  createProductionDispatchPayload,
  InvalidWorkflowArtifactError,
  loadValidWorkflowArtifacts,
  newestSuccessfulArtifact,
  parseArtifactRunIds,
  parseArtifactRuns,
  parseReleases,
  parseArtifactJson,
  parseInternalWorkflowRuns,
  parseManifestRunIds,
  parsePromotionWorkflowRuns,
  parseProductionWorkflowRuns,
  parseTrackConfig,
  parseFailedWorkflowJobs,
  parseWorkflowJobs,
  parseWorkflowRuns,
  retryFailedJobsArgs,
} from './github'

describe('release workflow dispatch', () => {
  test('pins the trusted definition to main and passes source separately', () => {
    const sha = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'
    const requestId = '7f787fe8-4a30-4fcf-a3b1-4a9dd8606e38'
    expect(createDispatchPayload(sha, requestId, 'main', '- Faster startup\n')).toEqual({
      ref: 'main',
      inputs: { source_sha: sha.toLowerCase(), request_id: requestId },
      releaseBody: '- Faster startup\n',
    })
  })

  test('targets an explicit trusted workflow branch', () => {
    const sha = 'a'.repeat(40)
    const requestId = crypto.randomUUID()
    expect(createDispatchPayload(sha, requestId, 'dev', '- Notes\n').ref).toBe('dev')
  })

  test('correlates the exact structured run title', () => {
    const requestId = '7f787fe8-4a30-4fcf-a3b1-4a9dd8606e38'
    const run = {
      id: 302,
      html_url: 'https://example.test/run/302',
      display_title: `Internal ${requestId}`,
      status: 'queued' as const,
      conclusion: null,
    }
    expect(
      parseWorkflowRuns(
        { workflow_runs: [{ ...run, id: 1, display_title: 'other' }, run] },
        requestId,
      ),
    ).toEqual(run)
  })

  test('names failed jobs from the structured workflow result', () => {
    expect(
      parseFailedWorkflowJobs({
        jobs: [
          { name: 'Release gates', conclusion: 'failure' },
          { name: 'Build signed artifacts once', conclusion: 'skipped' },
          { name: 'Cleanup', conclusion: 'success' },
        ],
      }),
    ).toEqual(['Release gates'])
  })

  test('discovers resumable internal runs and their live steps', () => {
    const resumable = {
      id: 302,
      html_url: 'https://example.test/run/302',
      display_title: `Internal ${crypto.randomUUID()}`,
      status: 'in_progress' as const,
      conclusion: null,
    }
    expect(
      parseInternalWorkflowRuns({
        workflow_runs: [resumable, { ...resumable, id: 1, display_title: 'Legacy release' }],
      }),
    ).toEqual([resumable])
    expect(
      parseWorkflowJobs({
        jobs: [
          {
            id: 10,
            name: 'Build signed artifacts once',
            status: 'in_progress',
            conclusion: null,
            steps: [{ name: 'Build phone and Wear AABs', status: 'in_progress' }],
          },
        ],
      })[0]?.steps[0]?.name,
    ).toBe('Build phone and Wear AABs')
  })

  test('builds a failed-jobs-only retry command', () => {
    expect(retryFailedJobsArgs(123)).toEqual(['run', 'rerun', '123', '--failed'])
    expect(() => retryFailedJobsArgs(0)).toThrow('Invalid workflow run ID')
  })

  test('reports empty and malformed workflow artifacts clearly', () => {
    expect(() => parseArtifactJson('', 'Promotion manifest')).toThrow('Promotion manifest is empty')
    expect(() => parseArtifactJson('{', 'Promotion manifest')).toThrow(
      'Promotion manifest is invalid JSON',
    )
    expect(parseArtifactJson('{"ok":true}', 'Promotion manifest')).toEqual({ ok: true })
  })

  test('skips invalid historical artifacts without hiding download failures', async () => {
    expect(
      await loadValidWorkflowArtifacts([3, 2], async (runId) => {
        if (runId === 2) throw new InvalidWorkflowArtifactError('empty')
        return `manifest-${runId}`
      }),
    ).toEqual([{ runId: 3, artifact: 'manifest-3' }])

    expect(
      loadValidWorkflowArtifacts([3], async () => {
        throw new Error('GitHub unavailable')
      }),
    ).rejects.toThrow('GitHub unavailable')
  })

  test('stops downloading once the requested number of valid artifacts is reached', async () => {
    const downloaded: number[] = []
    const artifacts = await loadValidWorkflowArtifacts(
      [5, 4, 3],
      async (runId) => {
        downloaded.push(runId)
        return `manifest-${runId}`
      },
      1,
    )
    expect(artifacts).toEqual([{ runId: 5, artifact: 'manifest-5' }])
    expect(downloaded).toEqual([5])
  })

  test('reads track state from the newest successful run, not a newer failed one', async () => {
    expect(
      await newestSuccessfulArtifact(
        [7, 6, 5],
        async (runId) => ({ runId, ok: runId === 5 }),
        (artifact) => artifact.ok,
      ),
    ).toEqual({
      success: { runId: 5, artifact: { runId: 5, ok: true } },
      failures: [
        { runId: 7, artifact: { runId: 7, ok: false } },
        { runId: 6, artifact: { runId: 6, ok: false } },
      ],
      truncated: false,
    })
  })

  test('skips unparseable artifacts without counting them as failures', async () => {
    expect(
      await newestSuccessfulArtifact(
        [5, 4],
        async (runId) => {
          if (runId === 5) throw new InvalidWorkflowArtifactError('empty')
          return { ok: true }
        },
        (artifact) => artifact.ok,
      ),
    ).toEqual({ success: { runId: 4, artifact: { ok: true } }, failures: [], truncated: false })
  })

  test('counts unparseable artifacts against the scan budget', async () => {
    const downloaded: number[] = []
    await newestSuccessfulArtifact(
      [9, 8, 7, 6, 5],
      async (runId) => {
        downloaded.push(runId)
        throw new InvalidWorkflowArtifactError('empty')
      },
      () => true,
      2,
    )
    expect(downloaded).toEqual([9, 8])
  })

  test('reports a truncated scan so an unread history is not read as never-published', async () => {
    const outcome = await newestSuccessfulArtifact(
      [9, 8, 7],
      async () => ({ ok: false }),
      (artifact) => artifact.ok,
      2,
    )
    expect(outcome).toEqual({
      success: null,
      failures: [
        { runId: 9, artifact: { ok: false } },
        { runId: 8, artifact: { ok: false } },
      ],
      truncated: true,
    })
  })

  test('does not report truncation when the whole history was scanned', async () => {
    const outcome = await newestSuccessfulArtifact(
      [9],
      async () => ({ ok: false }),
      (artifact) => artifact.ok,
      5,
    )
    expect(outcome.truncated).toBe(false)
  })

  test('stops scanning after the cap so a long failure history cannot stall the dashboard', async () => {
    const downloaded: number[] = []
    const outcome = await newestSuccessfulArtifact(
      [9, 8, 7, 6],
      async (runId) => {
        downloaded.push(runId)
        return { ok: false }
      },
      (artifact) => artifact.ok,
      2,
    )
    expect(outcome.success).toBeNull()
    expect(downloaded).toEqual([9, 8])
  })

  test('lists artifact runs newest first with creation time, ignoring duplicates', () => {
    expect(
      parseArtifactRuns(
        {
          artifacts: [
            {
              name: 'release-manifest',
              expired: false,
              created_at: '2026-08-01T10:00:00Z',
              workflow_run: { id: 7 },
            },
            {
              name: 'release-manifest',
              expired: false,
              created_at: '2026-08-01T11:00:00Z',
              workflow_run: { id: 9 },
            },
            {
              name: 'release-manifest',
              expired: false,
              created_at: '2026-08-01T10:00:00Z',
              workflow_run: { id: 7 },
            },
            { name: 'release-manifest', expired: true, workflow_run: { id: 11 } },
            { name: 'promotion-manifest', expired: false, workflow_run: { id: 12 } },
          ],
        },
        'release-manifest',
      ),
    ).toEqual([
      { runId: 9, createdAt: '2026-08-01T11:00:00Z' },
      { runId: 7, createdAt: '2026-08-01T10:00:00Z' },
    ])
  })

  test('keeps only prerelease tags from the release listing', () => {
    expect(
      parseReleases([
        { tagName: 'v1.8.0', isPrerelease: true },
        { tagName: 'v1.7.1', isPrerelease: false },
        { tagName: 'broken' },
      ]),
    ).toEqual([
      { tagName: 'v1.8.0', isPrerelease: true },
      { tagName: 'v1.7.1', isPrerelease: false },
    ])
    expect(() => parseReleases({})).toThrow('Release listing is invalid')
  })

  test('dispatches exact candidate identity from trusted main', () => {
    const manifest = {
      schemaVersion: 1 as const,
      requestId: crypto.randomUUID(),
      sourceSha: 'a'.repeat(40),
      marketingVersion: '0.83.1',
      versionCodes: { phone: 100_000_042, wear: 1_100_000_042 },
      workflow: { runId: 123, runUrl: 'https://example.test/123', runAttempt: 1 },
      artifacts: {
        phone: { name: 'phone.aab', sha256: 'a', signingCertificateSha256: 'c' },
        wear: { name: 'wear.aab', sha256: 'b', signingCertificateSha256: 'c' },
      },
      uploads: { phone: 'succeeded' as const, wear: 'succeeded' as const },
    }
    const requestId = crypto.randomUUID()
    expect(createPromotionDispatchPayload(manifest, requestId)).toEqual({
      ref: 'main',
      inputs: {
        request_id: requestId,
        candidate_run_id: '123',
        source_sha: 'a'.repeat(40),
        marketing_version: '0.83.1',
        phone_code: '100000042',
        wear_code: '1100000042',
      },
    })
  })

  test('lists only live release-manifest artifact runs once', () => {
    expect(
      parseManifestRunIds({
        artifacts: [
          { name: 'release-manifest', expired: false, workflow_run: { id: 3 } },
          { name: 'release-manifest', expired: false, workflow_run: { id: 3 } },
          { name: 'release-manifest', expired: true, workflow_run: { id: 2 } },
          { name: 'other', expired: false, workflow_run: { id: 1 } },
        ],
      }),
    ).toEqual([3])
  })

  test('uses configured phone and Wear track IDs', () => {
    expect(
      parseTrackConfig({
        variables: [
          { name: 'PLAY_PHONE_OPEN_TRACK', value: 'open-testing' },
          { name: 'PLAY_WEAR_OPEN_TRACK', value: 'wear:open-testing' },
        ],
      }),
    ).toEqual({
      phoneInternal: 'internal',
      phoneOpen: 'open-testing',
      phoneProduction: 'production',
      wearInternal: 'wear:internal',
      wearOpen: 'wear:open-testing',
      wearProduction: 'wear:production',
    })
  })

  test('correlates exact open-promotion run title', () => {
    const requestId = crypto.randomUUID()
    expect(
      parsePromotionWorkflowRuns(
        {
          workflow_runs: [
            {
              id: 304,
              html_url: 'https://example.test/304',
              display_title: `Open ${requestId}`,
              status: 'queued',
              conclusion: null,
            },
          ],
        },
        requestId,
      )?.id,
    ).toBe(304)
  })

  test('lists only successful open-proof artifact runs', () => {
    expect(
      parseArtifactRunIds(
        {
          artifacts: [
            { name: 'promotion-manifest', expired: false, workflow_run: { id: 8 } },
            { name: 'promotion-manifest', expired: true, workflow_run: { id: 7 } },
            { name: 'release-manifest', expired: false, workflow_run: { id: 6 } },
          ],
        },
        'promotion-manifest',
      ),
    ).toEqual([8])
  })

  test('dispatches exact production identity and explicit rollout', () => {
    const release = {
      schemaVersion: 1 as const,
      requestId: crypto.randomUUID(),
      sourceSha: 'a'.repeat(40),
      marketingVersion: '0.83.1',
      versionCodes: { phone: 100_000_042, wear: 1_100_000_042 },
      workflow: { runId: 302, runUrl: 'https://example.test/302', runAttempt: 1 },
      artifacts: {
        phone: { name: 'phone.aab', sha256: 'a', signingCertificateSha256: 'c' },
        wear: { name: 'wear.aab', sha256: 'b', signingCertificateSha256: 'c' },
      },
      uploads: { phone: 'succeeded' as const, wear: 'succeeded' as const },
    }
    const open = {
      schemaVersion: 1 as const,
      requestId: crypto.randomUUID(),
      candidateRunId: 302,
      sourceSha: release.sourceSha,
      marketingVersion: release.marketingVersion,
      phone: {
        versionCode: release.versionCodes.phone,
        sourceTrack: 'internal',
        targetTrack: 'beta',
        status: 'promoted' as const,
      },
      wear: {
        versionCode: release.versionCodes.wear,
        sourceTrack: 'wear:internal',
        targetTrack: 'wear:beta',
        status: 'already-open' as const,
      },
    }
    const requestId = crypto.randomUUID()
    expect(
      createProductionDispatchPayload(
        { manifest: release, open, openPromotionRunId: 304 },
        'promote',
        requestId,
        10,
      ),
    ).toEqual({
      ref: 'main',
      inputs: {
        request_id: requestId,
        operation: 'promote',
        open_promotion_run_id: '304',
        candidate_run_id: '302',
        source_sha: release.sourceSha,
        marketing_version: '0.83.1',
        phone_code: '100000042',
        wear_code: '1100000042',
        rollout_percentage: '10',
      },
    })
    expect(() =>
      createProductionDispatchPayload(
        { manifest: release, open, openPromotionRunId: 304 },
        'advance',
        requestId,
        101,
      ),
    ).toThrow('Rollout percentage')
  })

  test('correlates exact production run title', () => {
    const requestId = crypto.randomUUID()
    expect(
      parseProductionWorkflowRuns(
        {
          workflow_runs: [
            {
              id: 305,
              html_url: 'https://example.test/305',
              display_title: `Production ${requestId}`,
              status: 'queued',
              conclusion: null,
            },
          ],
        },
        requestId,
      )?.id,
    ).toBe(305)
  })
})
