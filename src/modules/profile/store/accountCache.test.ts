import { expect, mock, test } from 'bun:test'

let finish: (value: unknown) => void
let credential: { state: string; accountId?: string } = { state: 'ready', accountId: 'viewer' }
const getFriendRides = mock(
  (_accountId: string, _limit: number) =>
    new Promise((resolve) => {
      finish = resolve
    }),
)
mock.module('vescape-core', () => ({
  getDeviceCredentialState: () => credential,
  getRiderProfile: () =>
    new Promise((resolve) => {
      finish = resolve
    }),
  saveRiderProfile: () =>
    new Promise((resolve) => {
      finish = resolve
    }),
  getFriendRides,
  getRodeWith: () =>
    new Promise((resolve) => {
      finish = resolve
    }),
  getFriends: async () => ({ friends: [], incoming: [], outgoing: [] }),
  acceptFriendRequest: async () => undefined,
  deleteFriendRequest: async () => undefined,
  removeFriend: async () => undefined,
  sendFriendRequest: async () => undefined,
}))
const { useRiderProfileStore: profile } = await import('./riderProfileStore')
const { useFriendRidesStore: friends } = await import('../../group-ride/store/friendRidesStore')
const { useRodeWithStore: rode } = await import('../../group-ride/store/rodeWithStore')
const { useDeviceAuthStore: deviceAuth } = await import('./deviceAuthStore')
await import('../../../bootstrap/accountCacheSync')

test('auth status settling for an already signed-in account keeps the first profile load', async () => {
  const load = profile.getState().load()
  deviceAuth.getState().setStatus('ready')
  finish!({ nick: 'kept' })
  await load
  expect(profile.getState().profile?.nick).toBe('kept')

  credential = { state: 'ready', accountId: 'other' }
  deviceAuth.getState().setStatus('provisioning')
  expect(profile.getState()).toMatchObject({ profile: null, loaded: false })
  credential = { state: 'ready', accountId: 'viewer' }
})

test('old profile save cannot overwrite or cancel the new account load', async () => {
  const save = profile.getState().save({ nick: 'old', nationality: null })
  const old = finish!
  profile.getState().clear()
  const load = profile.getState().load()
  const current = finish!
  old({ nick: 'old' })
  await expect(save).rejects.toThrow('Account changed')
  current({ nick: 'new' })
  await load
  expect(profile.getState().profile?.nick).toBe('new')
})

test('clearing invalidates a pending friend rides load', async () => {
  const pending = friends.getState().load('friend')
  friends.getState().clear()
  finish!({
    rides: [{ startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:01:00Z' }],
  })
  await pending
  expect(friends.getState().rides).toEqual([])
})

test('same ride after account transition rejects the old response', async () => {
  const first = rode.getState().load(0, 1000)
  const old = finish!
  rode.getState().clear()
  const second = rode.getState().load(0, 1000)
  old([{ startedAt: '', endedAt: '', riders: [] }])
  await first
  expect(rode.getState().riders).toEqual([])
  finish!([])
  await second
})

test('friend rides store requests and retains at most five public rides', async () => {
  const rides = Array.from({ length: 6 }, (_, index) => ({
    startedAt: new Date(Date.UTC(2026, 0, 6 - index)).toISOString(),
    endedAt: new Date(Date.UTC(2026, 0, 6 - index, 0, 1)).toISOString(),
  }))
  const pending = friends.getState().load('friend')
  expect(getFriendRides).toHaveBeenLastCalledWith('friend', 5)
  finish!({ rides, nextBefore: rides.at(-1)?.startedAt })
  await pending
  expect(friends.getState()).toMatchObject({ rides: rides.slice(0, 5), loading: false })
})
