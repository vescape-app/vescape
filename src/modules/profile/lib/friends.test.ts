import { expect, test } from 'bun:test'
import type { Friend } from 'vescape-core'

import {
  friendRelation,
  friendStartedRiding,
  riderSearchPrefix,
  sortFriends,
} from '@/modules/profile/lib/friends'

const friend = (
  accountId: string,
  ridingNow: boolean,
  lastOnlineAt: string | null = null,
): Friend => ({
  accountId,
  nick: accountId,
  nationality: null,
  ridingNow,
  lastOnlineAt,
})

test('search prefix follows the server rule', () => {
  expect(riderSearchPrefix('  kup ')).toBe('kup')
  for (const input of ['', ' ', 'has space', 'zażółć', 'a'.repeat(21)]) {
    expect(riderSearchPrefix(input)).toBeNull()
  }
})

test('a friend who starts riding lights the badge; one still riding does not', () => {
  const before = [friend('a', true), friend('b', false)]
  expect(friendStartedRiding(before, [friend('a', true), friend('b', false)])).toBe(false)
  expect(friendStartedRiding(before, [friend('a', false), friend('b', true)])).toBe(true)
  expect(friendStartedRiding(before, [...before, friend('new', true)])).toBe(true)
})

test('relation reads friends before pending requests and knows self', () => {
  const lists = { friends: [friend('f', false)], incoming: [], outgoing: [] }
  expect(friendRelation(lists, 'me', 'me')).toBe('self')
  expect(friendRelation(lists, 'f', 'me')).toBe('friend')
  expect(friendRelation(lists, 'x', 'me')).toBe('none')
})

test('riding friends first, then most recently online, never-online last', () => {
  const rows = sortFriends([
    friend('never', false),
    friend('old', false, '2026-01-01T00:00:00Z'),
    friend('riding', true),
    friend('recent', false, '2026-11-01T00:00:00Z'),
  ])
  expect(rows.map((row) => row.accountId)).toEqual(['riding', 'recent', 'old', 'never'])
})
