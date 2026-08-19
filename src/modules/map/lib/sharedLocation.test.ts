import { describe, expect, it } from 'bun:test'

import {
  androidMapLocationUrl,
  parseSharedLocation,
  sharedLocationMessage,
  sharedLocationUrl,
} from '@/modules/map/lib/sharedLocation'
import { resolveSharedLocation, shortLocationLink } from '@/modules/map/lib/sharedLocationResolve'

describe('parseSharedLocation', () => {
  it('reads a geo URI', () => {
    expect(parseSharedLocation('geo:52.2297,21.0122')).toEqual({
      latitude: 52.2297,
      longitude: 21.0122,
      name: null,
    })
  })

  it('reads the query of a placeholder geo URI, with its label', () => {
    expect(parseSharedLocation('geo:0,0?q=52.2297,21.0122(Palm Tree)')).toEqual({
      latitude: 52.2297,
      longitude: 21.0122,
      name: 'Palm Tree',
    })
  })

  it('prefers the Google Maps place pin over the viewport centre', () => {
    const shared =
      'https://www.google.com/maps/place/Rondo/@52.1000000,21.1000000,17z/data=!3m1!4b1!4m6!3d52.2297!4d21.0122'
    expect(parseSharedLocation(shared)).toEqual({
      latitude: 52.2297,
      longitude: 21.0122,
      name: 'Rondo',
    })
  })

  it('reads a coordinate out of a sentence around the link', () => {
    const shared = 'meet me here https://maps.apple.com/?ll=52.2297,21.0122&q=Skate%20Park ok?'
    expect(parseSharedLocation(shared)).toEqual({
      latitude: 52.2297,
      longitude: 21.0122,
      name: 'Skate Park',
    })
  })

  it('reads an OpenStreetMap marker', () => {
    expect(parseSharedLocation('https://www.openstreetmap.org/?mlat=52.2297&mlon=21.0122')).toEqual(
      {
        latitude: 52.2297,
        longitude: 21.0122,
        name: null,
      },
    )
  })

  it('reads a pasted pair', () => {
    expect(parseSharedLocation('52.2297, 21.0122')).toEqual({
      latitude: 52.2297,
      longitude: 21.0122,
      name: null,
    })
  })

  it('rejects payloads with no coordinate', () => {
    expect(parseSharedLocation('')).toBeNull()
    expect(parseSharedLocation('check out this cafe')).toBeNull()
    expect(parseSharedLocation('https://maps.app.goo.gl/abc123')).toBeNull()
  })

  it('rejects out-of-range pairs rather than clamping them', () => {
    expect(parseSharedLocation('geo:95.0,21.0122')).toBeNull()
    expect(parseSharedLocation('geo:52.2297,201.5')).toBeNull()
  })
})

describe('sharedLocationMessage', () => {
  it('carries coordinates and an openable link', () => {
    const message = sharedLocationMessage({
      latitude: 52.2297,
      longitude: 21.0122,
      name: 'Palm Tree',
    })
    expect(message).toBe(`Palm Tree\n52.2297, 21.0122\n${sharedLocationUrl(52.2297, 21.0122)}`)
  })

  it('round-trips back into a coordinate', () => {
    const message = sharedLocationMessage({ latitude: -33.8688, longitude: 151.2093, name: null })
    expect(parseSharedLocation(message)).toEqual({
      latitude: -33.8688,
      longitude: 151.2093,
      name: null,
    })
  })
})

describe('androidMapLocationUrl', () => {
  it('creates a geo intent URL handled by installed map apps', () => {
    expect(
      androidMapLocationUrl({ latitude: 52.2297, longitude: 21.0122, name: 'Palm Tree' }),
    ).toBe('geo:52.2297,21.0122?q=52.2297%2C21.0122(Palm%20Tree)')
  })

  it('uses coordinates as the query when the location has no name', () => {
    expect(androidMapLocationUrl({ latitude: -33.8688, longitude: 151.2093, name: null })).toBe(
      'geo:-33.8688,151.2093?q=-33.8688%2C151.2093',
    )
  })
})

describe('shortLocationLink', () => {
  it('finds a link worth following', () => {
    expect(shortLocationLink('look https://maps.app.goo.gl/abc123 here')).toBe(
      'https://maps.app.goo.gl/abc123',
    )
  })

  it('ignores links that are not location short links', () => {
    expect(shortLocationLink('https://vescape.app/blog')).toBeNull()
    expect(shortLocationLink('no link at all')).toBeNull()
  })

  it('delegates opaque Google links to the native resolver', async () => {
    const links: string[] = []
    const location = await resolveSharedLocation('https://maps.app.goo.gl/BA5CZoXopVV5MjEm8', {
      resolveLink: async (link) => {
        links.push(link)
        return { latitude: 51.1246336, longitude: 16.941056, name: 'Górka Szczepińska' }
      },
    })

    expect(links).toEqual(['https://maps.app.goo.gl/BA5CZoXopVV5MjEm8'])
    expect(location).toEqual({
      latitude: 51.1246336,
      longitude: 16.941056,
      name: 'Górka Szczepińska',
    })
  })

  it('turns native resolver failures into an unreadable share', async () => {
    expect(
      await resolveSharedLocation('https://maps.app.goo.gl/broken', {
        resolveLink: async () => {
          throw new Error('offline')
        },
      }),
    ).toBeNull()
  })
})
