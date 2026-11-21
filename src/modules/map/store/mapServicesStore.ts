import Mapbox from '@rnmapbox/maps'
import { create } from 'zustand'

import { addServiceConfigListener, getServiceConfig, type ServiceConfig } from 'vescape-core'

import { buildMapyTileUrlTemplate } from '@/modules/map/lib/mapyTiles'

interface MapServicesState {
  mapboxToken: string | null
  mapyTileUrlTemplate: string | null
}

function project(config: ServiceConfig): MapServicesState {
  return {
    mapboxToken: config.mapboxToken,
    mapyTileUrlTemplate: buildMapyTileUrlTemplate(config.mapyToken),
  }
}

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

export function startMapServicesSync(): () => void {
  const sub = addServiceConfigListener((event) => apply(event.config))
  return () => sub.remove()
}
