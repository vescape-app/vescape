import Mapbox from '@rnmapbox/maps'
import { create } from 'zustand'

import { addServiceConfigListener, getServiceConfig, type ServiceConfig } from 'vescape-core'

import { buildMapyTileUrlTemplate } from '@/modules/map/lib/mapyTiles'

/**
 * JS projection of native Service Config for the map SDKs. Native resolves the tokens (persisted
 * server answer, else the build-time seed) and refreshes them on foreground; this store only derives
 * what rendering needs and hands the Mapbox token to `@rnmapbox/maps`.
 *
 * The first projection runs when this module loads, before any map view can mount, so the Mapbox
 * SDK never starts without the token native already knows.
 */
interface MapServicesState {
  /** Mapbox public token, or `null` when the server and the build both lack one. */
  mapboxToken: string | null
  /** Mapy outdoor raster template, or `null` when Mapy is not configured. */
  mapyTileUrlTemplate: string | null
}

function project(config: ServiceConfig): MapServicesState {
  return {
    mapboxToken: config.mapboxToken,
    mapyTileUrlTemplate: buildMapyTileUrlTemplate(config.mapyToken),
  }
}

/** Token last handed to the Mapbox SDK; `undefined` until the first projection. */
let sdkToken: string | null | undefined

function apply(config: ServiceConfig) {
  const next = project(config)
  if (next.mapboxToken !== sdkToken) {
    sdkToken = next.mapboxToken
    void Mapbox.setAccessToken(next.mapboxToken ?? '')
  }
  useMapServicesStore.setState(next)
}

export const useMapServicesStore = create<MapServicesState>(() => ({
  mapboxToken: null,
  mapyTileUrlTemplate: null,
}))

apply(getServiceConfig())

/**
 * Wire the native → JS Service Config mirror. Call once at app root; returns an unsubscribe.
 * Push only: native replays the current config on subscribe and emits every later change.
 */
export function startMapServicesSync(): () => void {
  const sub = addServiceConfigListener((event) => apply(event.config))
  return () => sub.remove()
}
