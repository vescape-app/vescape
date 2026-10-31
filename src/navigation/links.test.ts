import { describe, expect, it } from 'bun:test'

import { parseRideDay, parseRideLink, rideDayHref, rideHref } from '@/navigation/links'

describe('ride link', () => {
  it('round-trips through the href params', () => {
    const href = rideHref({ rideId: 'board:1:2', focus: 'topSpeed' })
    const params = typeof href === 'object' ? (href.params as Record<string, string>) : {}
    expect(parseRideLink(params)).toEqual({
      rideId: 'board:1:2',
      focus: 'topSpeed',
    })
  })

  it('opens the ride plainly on a focus it does not know', () => {
    expect(parseRideLink({ ride: 'board:1:2', focus: 'freespin' })).toEqual({
      rideId: 'board:1:2',
      focus: null,
    })
  })

  it('takes the first value of a repeated param and ignores a missing ride', () => {
    expect(parseRideLink({ ride: ['a:1:2', 'b:3:4'] })?.rideId).toBe('a:1:2')
    expect(parseRideLink({ focus: 'topSpeed' })).toBeNull()
  })
})

describe('ride day link', () => {
  it('round-trips through the href params', () => {
    const href = rideDayHref({ year: 2026, month: 8, day: 3 })
    const params = typeof href === 'object' ? (href.params as Record<string, string>) : {}
    expect(parseRideDay(params)).toEqual({ year: 2026, month: 8, day: 3 })
  })

  it('rejects a missing or malformed date', () => {
    expect(parseRideDay({})).toBeNull()
    expect(parseRideDay({ date: '2026-08' })).toBeNull()
  })
})
