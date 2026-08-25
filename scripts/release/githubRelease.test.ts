import { describe, expect, test } from 'bun:test'

import { publishGithubRelease } from './githubRelease'

const candidate = { marketingVersion: '0.84.0', sourceSha: 'a'.repeat(40) }

const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' })
const missing = () => ({ exitCode: 1, stdout: '', stderr: 'not found' })

describe('GitHub release publishing', () => {
  test('creates immutable tag with canonical notes from the release commit', async () => {
    const calls: string[] = []
    let uploadedBody = ''
    const result = await publishGithubRelease('vescape-app/vescape', candidate, {
      run: async (command, args) => {
        calls.push(`${command} ${args.join(' ')}`)
        if (command === 'git' && args[0] === 'rev-parse' && args[2]?.startsWith('v')) {
          return missing()
        }
        if (command === 'git' && args[0] === 'ls-remote') return ok()
        if (command === 'git' && args[0] === 'show') return ok('## Fixed\n\n- Faster startup')
        if (command === 'gh' && args[1] === 'view') return missing()
        if (command === 'gh' && args[1] === 'create') {
          uploadedBody = await Bun.file(args[args.indexOf('--notes-file') + 1]).text()
        }
        return ok(candidate.sourceSha)
      },
    })

    expect(result).toBe('created')
    expect(calls).toContain(`git show ${candidate.sourceSha}:release-notes/0.84.0.md`)
    expect(calls).toContain(`git tag v0.84.0 ${candidate.sourceSha}`)
    expect(calls).toContain('git push origin refs/tags/v0.84.0')
    expect(calls.some((call) => call.includes('gh release create v0.84.0'))).toBe(true)
    expect(calls.some((call) => call.includes('--verify-tag --latest --notes-file'))).toBe(true)
    expect(uploadedBody).toBe('## Fixed\n\n- Faster startup\n')
  })

  test('reuses matching remote tag and existing release without reading notes', async () => {
    const calls: string[] = []
    const result = await publishGithubRelease('vescape-app/vescape', candidate, {
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
    expect(calls.some((call) => call.includes('git show'))).toBe(false)
    expect(calls.some((call) => call.includes('git push'))).toBe(false)
    expect(calls.some((call) => call.includes('gh release create'))).toBe(false)
  })

  test('requires canonical notes in the release commit', async () => {
    await expect(
      publishGithubRelease('vescape-app/vescape', candidate, {
        run: async (command, args) => {
          if (command === 'git' && args[0] === 'ls-remote') {
            return ok(`${candidate.sourceSha}\trefs/tags/v0.84.0`)
          }
          if (command === 'git' && args[0] === 'show') return missing()
          if (command === 'gh' && args[1] === 'view') return missing()
          return ok(candidate.sourceSha)
        },
      }),
    ).rejects.toThrow('Cannot read canonical release notes release-notes/0.84.0.md')
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
