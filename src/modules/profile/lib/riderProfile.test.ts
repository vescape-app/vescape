import { expect, test } from 'bun:test'

import { parseRiderProfileDraft } from '@/modules/profile/lib/riderProfile'

test('keeps nick case, upper-cases nationality, blanks it to null', () => {
  expect(parseRiderProfileDraft('  Kupa_99 ', ' pl ')).toEqual({
    draft: { nick: 'Kupa_99', nationality: 'PL' },
  })
  expect(parseRiderProfileDraft('abc', '  ')).toEqual({ draft: { nick: 'abc', nationality: null } })
})

test('rejects nicks and nationalities the server would refuse', () => {
  for (const nick of ['ab', 'a'.repeat(21), 'has space', 'zażółć', 'dash-ed']) {
    expect('error' in parseRiderProfileDraft(nick, '')).toBe(true)
  }
  expect('error' in parseRiderProfileDraft('valid', 'POL')).toBe(true)
  expect('error' in parseRiderProfileDraft('valid', 'p1')).toBe(true)
})
