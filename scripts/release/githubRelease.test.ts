import { describe, expect, test } from 'bun:test'

import { publishGithubRelease } from './githubRelease'

const candidate = { marketingVersion: '0.84.0', sourceSha: 'a'.repeat(40) }

const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' })
const missing = () => ({ exitCode: 1, stdout: '', stderr: 'not found' })

describe('GitHub release publishing', () => {
  test('creates immutable tag and codex-authored release from the release commit', async () => {
    const calls: string[] = []
    let generatedFrom: unknown
    let uploadedBody = ''
    const result = await publishGithubRelease('vescape-app/vescape', candidate, {
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
        return ok(candidate.sourceSha)
      },
    })

    expect(result).toBe('created')
    expect(generatedFrom).toMatchObject({
      root: '/repo',
      version: '0.84.0',
      previousTag: 'v0.83.2',
      commitLog: '- Improve startup (abc1234)',
    })
    expect(calls).toContain(`git tag v0.84.0 ${candidate.sourceSha}`)
    expect(calls).toContain('git push origin refs/tags/v0.84.0')
    expect(calls.some((call) => call.includes('gh release create v0.84.0'))).toBe(true)
    expect(calls.some((call) => call.includes('--verify-tag --latest --notes-file'))).toBe(true)
    expect(uploadedBody).toBe('- Faster startup\n')
  })

  test('reuses matching remote tag and existing release without regenerating notes', async () => {
    const calls: string[] = []
    let generated = false
    const result = await publishGithubRelease('vescape-app/vescape', candidate, {
      generateBody: async () => {
        generated = true
        return 'unused'
      },
      run: async (command, args) => {
        calls.push(`${command} ${args.join(' ')}`)
        if (command === 'git' && args[0] === 'ls-remote') {
          return ok(`${candidate.sourceSha}\trefs/tags/v0.84.0`)
        }
        if (command === 'gh' && args[1] === 'view') return ok('v0.84.0')
        return ok(candidate.sourceSha)
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
    await publishGithubRelease('vescape-app/vescape', candidate, {
      root: '/repo',
      generateBody: async (options) => {
        generatedFrom = options
        return '- First release\n'
      },
      run: async (command, args) => {
        if (command === 'git' && args[0] === 'ls-remote') {
          return ok(`${candidate.sourceSha}\trefs/tags/v0.84.0`)
        }
        if (command === 'git' && args[0] === 'describe') return missing()
        if (command === 'git' && args[0] === 'log') {
          loggedRange = args.at(-1) ?? ''
          return ok('- First release (abc1234)')
        }
        if (command === 'gh' && args[1] === 'view') return missing()
        return ok(candidate.sourceSha)
      },
    })

    expect(loggedRange).toBe(candidate.sourceSha)
    expect(generatedFrom).toMatchObject({
      previousTag: null,
      commitLog: '- First release (abc1234)',
    })
  })

  test('refuses a mismatched immutable tag', async () => {
    await expect(
      publishGithubRelease('vescape-app/vescape', candidate, {
        run: async (command, args) => {
          if (command === 'git' && args[0] === 'ls-remote') {
            return ok(`${'b'.repeat(40)}\trefs/tags/v0.84.0`)
          }
          return ok(candidate.sourceSha)
        },
      }),
    ).rejects.toThrow('Immutable tag v0.84.0 already points')
  })
})
