import { expect, mock, test } from 'bun:test'
import type { ServiceConfig, ServiceConfigEvent } from 'vescape-core'

const actualCore = await import('@/../modules/vescape-core/src/index')
const sdkTokens: (string | null)[] = []
let onServiceConfig: (event: ServiceConfigEvent) => void = () => {}
let removed = 0

mock.module('@rnmapbox/maps', () => ({
  default: {
    setAccessToken: async (token: string | null) => {
      sdkTokens.push(token)
      return token
    },
  },
}))
mock.module('vescape-core', () => ({
  ...actualCore,
  getServiceConfig: (): ServiceConfig => ({ mapboxToken: 'pk.seed', mapyToken: null }),
  addServiceConfigListener: (listener: (event: ServiceConfigEvent) => void) => {
    onServiceConfig = listener
    return {
      remove() {
        removed += 1
      },
    }
  },
}))

const { startMapServicesSync, useMapServicesStore } = await import('./mapServicesStore')

test('configures Mapbox from native before any map mounts, then follows native changes', () => {
  expect(sdkTokens).toEqual(['pk.seed'])
  expect(useMapServicesStore.getState().mapyTileUrlTemplate).toBeNull()

  const stop = startMapServicesSync()
  // Native replays the current config on subscribe: same token, no second SDK call.
  onServiceConfig({ config: { mapboxToken: 'pk.seed', mapyToken: 'mapy-key' } })
  expect(sdkTokens).toEqual(['pk.seed'])
  expect(useMapServicesStore.getState().mapyTileUrlTemplate).toContain('apikey=mapy-key')

  onServiceConfig({ config: { mapboxToken: null, mapyToken: null } })
  expect(sdkTokens).toEqual(['pk.seed', ''])
  expect(useMapServicesStore.getState()).toMatchObject({
    mapboxToken: null,
    mapyTileUrlTemplate: null,
  })

  stop()
  expect(removed).toBe(1)
})
