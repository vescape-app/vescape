import { describe, expect, test } from 'bun:test'

import { formatSpeedValue } from '@/helpers/units'
import { riderStats } from '@/modules/group-ride/lib/riderStats'

describe('Group Ride speed presentation', () => {
  test('treats presence speed as m/s and leaves the wire values unchanged', () => {
    const presence = { lat: 50, lng: 20, speed: 10, soc: 0.5, motorTemp: 45 }
    expect(riderStats(presence, 'km').speed.value).toBe('36')
    expect(riderStats(presence, 'mi').speed.value).toBe('22')
    expect(riderStats(presence, 'mi').speed.value).toBe(formatSpeedValue(36, 'mi'))
    expect(riderStats(presence, 'km').soc.value).toBe('50%')
    expect(presence.speed).toBe(10)
  })

  test('preserves missing speed and a real zero in either unit system', () => {
    for (const units of ['km', 'mi'] as const) {
      expect(riderStats(null, units).speed.value).toBeUndefined()
      expect(riderStats({ lat: 50, lng: 20 }, units).speed.value).toBeUndefined()
      expect(riderStats({ lat: 50, lng: 20, speed: 0 }, units).speed.value).toBe('0')
    }
  })
})
