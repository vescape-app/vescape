import { describe, expect, test } from 'bun:test'
import { reviewReleaseNoteDraft } from './review'

const markdown = '## Improved\n\n- Easier releases.\n'

async function review(choice: 'accept' | 'change-version' | 'discard' | 'escape') {
  return reviewReleaseNoteDraft({
    root: process.cwd(),
    destination: '/tmp/unused-release-note.md',
    label: '1.2.3.md',
    editorCommand: ['true'],
    initialPrompt: 'unused',
    initialDraft: { markdown, threadId: 'thread-1' },
    persist: false,
    allowVersionChange: true,
    select: async () => {
      if (choice === 'escape') throw new Error('Selection cancelled')
      return choice
    },
  })
}

describe('release-note review decisions', () => {
  test('accepts the reviewed draft without writing it', async () => {
    expect(await review('accept')).toMatchObject({ kind: 'accepted', markdown })
  })

  test('preserves notes when changing the version', async () => {
    expect(await review('change-version')).toMatchObject({ kind: 'change-version', markdown })
  })

  test('distinguishes explicit discard from Escape pause', async () => {
    expect(await review('discard')).toEqual({ kind: 'discarded' })
    expect(await review('escape')).toEqual({ kind: 'paused' })
  })
})
