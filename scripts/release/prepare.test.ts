import { describe, expect, test } from 'bun:test'
import {
  assertReleasePreparationStatus,
  bumpMarketingVersion,
  parsePorcelainPaths,
  prepareReleaseNotes,
  releaseNotesPath,
} from './prepare'

describe('release candidate version bump', () => {
  test('calculates explicit major, minor, and patch versions', () => {
    expect(bumpMarketingVersion('0.83.1', 'major')).toBe('1.0.0')
    expect(bumpMarketingVersion('0.83.1', 'minor')).toBe('0.84.0')
    expect(bumpMarketingVersion('0.83.1', 'patch')).toBe('0.83.2')
  })

  test('refuses prerelease and malformed versions', () => {
    expect(() => bumpMarketingVersion('0.83.1-beta.1', 'patch')).toThrow('non-stable')
    expect(() => bumpMarketingVersion('83.1', 'minor')).toThrow('non-stable')
  })

  test('preserves the leading status column when reading changed paths', () => {
    expect(parsePorcelainPaths(' M package.json\n?? release-notes/0.83.2.md')).toEqual([
      'package.json',
      'release-notes/0.83.2.md',
    ])
  })

  test('allows resuming an exact previously accepted release draft', () => {
    expect(() =>
      assertReleasePreparationStatus({
        baseVersion: '0.83.1',
        workingVersion: '0.83.2',
        changedPaths: ['package.json', 'release-notes/0.83.2.md'],
        noteExists: true,
      }),
    ).not.toThrow()
  })

  test('allows resuming a release draft that skipped notes', () => {
    expect(() =>
      assertReleasePreparationStatus({
        baseVersion: '0.83.1',
        workingVersion: '0.83.2',
        changedPaths: ['package.json'],
        noteExists: false,
      }),
    ).not.toThrow()
  })

  test('rejects unrelated changes while resuming a release draft', () => {
    expect(() =>
      assertReleasePreparationStatus({
        baseVersion: '0.83.1',
        workingVersion: '0.83.2',
        changedPaths: ['package.json', 'release-notes/0.83.2.md', 'src/app.ts'],
        noteExists: true,
      }),
    ).toThrow('Commit or stash')
  })

  test('rejects a release draft that deletes existing notes', () => {
    expect(() =>
      assertReleasePreparationStatus({
        baseVersion: '0.83.1',
        workingVersion: '0.83.2',
        changedPaths: ['package.json', 'release-notes/0.83.2.md'],
        noteExists: false,
      }),
    ).toThrow('Commit or stash')
  })

  test('resolves every version to its own notes file', () => {
    expect(releaseNotesPath('0.84.3')).toBe('release-notes/0.84.3.md')
  })
})

describe('release-note authoring flow', () => {
  const markdown = '## Improved\n\n- Better release flow.\n'

  function dependencies(options: { exists: boolean; choice: 'draft' | 'skip' }) {
    let exists = options.exists
    const calls: string[] = []
    const deps = {
      exists: async () => exists,
      read: async () => markdown,
      select: async () => options.choice,
      author: async (version: string) => {
        calls.push(`author:${version}`)
        exists = true
      },
      validate: () => calls.push('validate'),
      build: async () => {
        calls.push('build')
      },
      log: () => {},
    }
    return { calls, deps }
  }

  test('skips notes when the author declines to draft them', async () => {
    const { calls, deps } = dependencies({ exists: false, choice: 'skip' })
    expect(await prepareReleaseNotes('0.85.1', deps)).toBe('release-notes/0.85.1.md')
    expect(calls).toEqual([])
  })

  test('drafts and validates notes for the exact version', async () => {
    const { calls, deps } = dependencies({ exists: false, choice: 'draft' })
    await prepareReleaseNotes('0.85.1', deps)
    expect(calls).toEqual(['author:0.85.1', 'validate', 'build'])
  })

  test('reuses accepted notes without redrafting them', async () => {
    const { calls, deps } = dependencies({ exists: true, choice: 'draft' })
    await prepareReleaseNotes('0.85.1', deps)
    expect(calls).toEqual(['validate', 'build'])
  })
})
