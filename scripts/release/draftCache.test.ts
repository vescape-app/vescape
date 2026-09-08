import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { clearReleaseDraft, loadReleaseDraft, saveReleaseDraft } from './draftCache'

let directory: string | null = null

afterEach(async () => {
  delete process.env.VESCAPE_RELEASE_DRAFT_PATH
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = null
})

describe('release draft recovery', () => {
  test('recovers only a draft for the same pinned source and base version', async () => {
    directory = await mkdtemp(join(tmpdir(), 'vescape-draft-test-'))
    process.env.VESCAPE_RELEASE_DRAFT_PATH = join(directory, 'draft.json')
    const draft = {
      sourceSha: 'a'.repeat(40),
      baseVersion: '0.92.1',
      bump: 'minor' as const,
      markdown: '## Improved\n\n- Cleaner releases.\n',
      threadId: 'thread-1',
    }

    await saveReleaseDraft(draft)

    expect(await loadReleaseDraft(draft.sourceSha, draft.baseVersion)).toEqual(draft)
    expect(await loadReleaseDraft('b'.repeat(40), draft.baseVersion)).toBeNull()
    await clearReleaseDraft()
    expect(await loadReleaseDraft(draft.sourceSha, draft.baseVersion)).toBeNull()
  })
})
