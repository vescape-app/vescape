import { describe, expect, test } from 'bun:test'

import { threadIdFromJsonl } from './codex'

describe('Codex JSONL adapter', () => {
  test('captures the resumable thread ID and ignores unrelated output', () => {
    expect(
      threadIdFromJsonl(
        ['not json', JSON.stringify({ type: 'thread.started', thread_id: 'thread-303' })].join(
          '\n',
        ),
      ),
    ).toBe('thread-303')
  })
})
