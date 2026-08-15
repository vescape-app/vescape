import { describe, expect, test } from 'bun:test'

import { publishGithubPrerelease } from './githubPrerelease'

const successfulManifest = {
  schemaVersion: 1 as const,
  requestId: crypto.randomUUID(),
  sourceSha: 'a'.repeat(40),
  marketingVersion: '0.84.0',
  versionCodes: { phone: 100_000_042, wear: 1_100_000_042 },
  workflow: { runId: 309, runUrl: 'https://example.test/309', runAttempt: 1 },
  artifacts: {
    phone: { name: 'phone.aab', sha256: 'a', signingCertificateSha256: 'c' },
    wear: { name: 'wear.aab', sha256: 'b', signingCertificateSha256: 'c' },
  },
  uploads: { phone: 'succeeded' as const, wear: 'succeeded' as const },
}

const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' })
const missing = () => ({ exitCode: 1, stdout: '', stderr: 'not found' })

describe('GitHub prerelease publishing', () => {
  test('creates immutable tag and codex-authored prerelease after successful internal upload', async () => {
    const calls: string[] = []
    let generatedFrom: unknown
    let uploadedBody = ''
    const result = await publishGithubPrerelease('vescape-app/vescape', successfulManifest, {
      root: '/repo',
      generateBody: async (options) => {
        generatedFrom = options
        return '- Faster startup\n'
      },
      run: async (command, args) => {
        calls.push(`${command} ${args.join(' ')}`)
        if (command === 'git' && args[0] === 'rev-parse' && args[2]?.startsWith('v')) {
          return missing()
        }
        if (command === 'git' && args[0] === 'ls-remote') return ok()
        if (command === 'git' && args[0] === 'describe') return ok('v0.83.2')
        if (command === 'git' && args[0] === 'log') return ok('- Improve startup (abc1234)')
        if (command === 'gh' && args[1] === 'view') return missing()
        if (command === 'gh' && args[1] === 'create') {
          uploadedBody = await Bun.file(args[args.indexOf('--notes-file') + 1]).text()
        }
        return ok(successfulManifest.sourceSha)
      },
    })

    expect(result).toBe('created')
    expect(generatedFrom).toMatchObject({
      root: '/repo',
      version: '0.84.0',
      previousTag: 'v0.83.2',
      commitLog: '- Improve startup (abc1234)',
    })
    expect(calls).toContain(`git tag v0.84.0 ${successfulManifest.sourceSha}`)
    expect(calls).toContain('git push origin refs/tags/v0.84.0')
    expect(calls.some((call) => call.includes('gh release create v0.84.0'))).toBe(true)
    expect(calls.some((call) => call.includes('--verify-tag --prerelease --notes-file'))).toBe(true)
    expect(uploadedBody).toBe('- Faster startup\n')
  })

  test('reuses matching remote tag and existing release without regenerating notes', async () => {
    const calls: string[] = []
    let generated = false
    const result = await publishGithubPrerelease('vescape-app/vescape', successfulManifest, {
      generateBody: async () => {
        generated = true
        return 'unused'
      },
      run: async (command, args) => {
        calls.push(`${command} ${args.join(' ')}`)
        if (command === 'git' && args[0] === 'ls-remote') {
          return ok(`${successfulManifest.sourceSha}\trefs/tags/v0.84.0`)
        }
        if (command === 'gh' && args[1] === 'view') return ok('v0.84.0')
        return ok(successfulManifest.sourceSha)
      },
    })

    expect(result).toBe('existing')
    expect(generated).toBe(false)
    expect(calls.some((call) => call.includes('git push'))).toBe(false)
    expect(calls.some((call) => call.includes('gh release create'))).toBe(false)
  })

  test('caps the commit log from repository start when no previous tag exists', async () => {
    let generatedFrom: { previousTag: string | null; commitLog: string } | undefined
    let loggedRange = ''
    await publishGithubPrerelease('vescape-app/vescape', successfulManifest, {
      root: '/repo',
      generateBody: async (options) => {
        generatedFrom = options
        return '- First release\n'
      },
      run: async (command, args) => {
        if (command === 'git' && args[0] === 'ls-remote') {
          return ok(`${successfulManifest.sourceSha}\trefs/tags/v0.84.0`)
        }
        if (command === 'git' && args[0] === 'describe') return missing()
        if (command === 'git' && args[0] === 'log') {
          loggedRange = args.at(-1) ?? ''
          return ok('- First release (abc1234)')
        }
        if (command === 'gh' && args[1] === 'view') return missing()
        return ok(successfulManifest.sourceSha)
      },
    })

    expect(loggedRange).toBe(successfulManifest.sourceSha)
    expect(generatedFrom).toMatchObject({
      previousTag: null,
      commitLog: '- First release (abc1234)',
    })
  })

  test('refuses failed uploads and mismatched immutable tags', async () => {
    let commands = 0
    await expect(
      publishGithubPrerelease(
        'vescape-app/vescape',
        { ...successfulManifest, uploads: { phone: 'failed', wear: 'succeeded' } },
        {
          run: async () => {
            commands += 1
            return ok()
          },
        },
      ),
    ).rejects.toThrow('unsuccessful internal release')
    expect(commands).toBe(0)

    await expect(
      publishGithubPrerelease('vescape-app/vescape', successfulManifest, {
        run: async (command, args) => {
          if (command === 'git' && args[0] === 'ls-remote') {
            return ok(`${'b'.repeat(40)}\trefs/tags/v0.84.0`)
          }
          return ok(successfulManifest.sourceSha)
        },
      }),
    ).rejects.toThrow('Immutable tag v0.84.0 already points')
  })
})
