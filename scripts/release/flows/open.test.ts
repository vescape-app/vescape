import { expect, test } from 'bun:test'
import type { ReleaseManifest } from '../contracts'
import { sendToOpenTesting } from './open'

const candidate = {
  marketingVersion: '0.92.1',
  workflow: { runId: 42 },
  uploads: { phone: 'succeeded', wear: 'succeeded' },
} as ReleaseManifest

test('one selection checks notes then sends the same build once', async () => {
  const events: string[] = []
  await sendToOpenTesting(
    candidate,
    async (selected) => {
      expect(selected).toBe(candidate)
      events.push('check')
      return 'release-notes/0.92.1.md'
    },
    async (selected, path) => {
      expect(selected).toBe(candidate)
      expect(path).toBe('release-notes/0.92.1.md')
      events.push('send')
    },
  )
  expect(events).toEqual(['check', 'send'])
})

test('failed uploads or missing notes prevent sending', async () => {
  let sent = false
  const send = async () => {
    sent = true
  }
  await expect(
    sendToOpenTesting(
      { ...candidate, uploads: { phone: 'succeeded', wear: 'failed' } },
      async () => '',
      send,
    ),
  ).rejects.toThrow('Both phone and watch')
  await expect(
    sendToOpenTesting(
      candidate,
      async () => {
        throw new Error('Notes missing')
      },
      send,
    ),
  ).rejects.toThrow('Notes missing')
  expect(sent).toBe(false)
})
