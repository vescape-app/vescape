import { expect, test } from 'bun:test'

import { readDeviceCredential } from './readDeviceCredential'

test('inaccessible storage remains distinct from missing credentials and recovers on next read', () => {
  const stored = { state: 'ready' as const, accountId: 'account', expiresAt: null }
  let locked = true
  const read = () => {
    if (locked) throw new Error('OSStatus error -34018')
    return stored
  }
  expect(readDeviceCredential(read)).toEqual({ status: null, error: 'OSStatus error -34018' })
  locked = false
  expect(readDeviceCredential(read)).toEqual({ status: stored, error: null })
  expect(
    readDeviceCredential(() => ({ state: 'unavailable', accountId: null, expiresAt: null })),
  ).toEqual({ status: { state: 'unavailable', accountId: null, expiresAt: null }, error: null })
})
