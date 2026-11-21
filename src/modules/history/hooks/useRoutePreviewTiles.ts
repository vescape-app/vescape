import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { PixelRatio } from 'react-native'
import { mapTile } from 'vescape-core'

import {
  routePreviewTiles,
  type RoutePoint,
  type RoutePreviewTile,
} from '@/modules/history/lib/routePreview'

export interface ResolvedRoutePreviewTile extends RoutePreviewTile {
  uri: string
}

const resolvedUris = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getVersion = () => version

const tileKey = (tile: RoutePreviewTile) => `${tile.z}/${tile.x}/${tile.y}`

async function requestTile(tile: RoutePreviewTile) {
  const key = tileKey(tile)
  if (resolvedUris.has(key)) return
  let uri: string | null
  try {
    uri = await mapTile(tile.z, tile.x, tile.y)
  } catch {
    return
  }
  if (!uri || resolvedUris.has(key)) return
  resolvedUris.set(key, uri)
  version++
  listeners.forEach((listener) => listener())
}

function resolveAll(tiles: RoutePreviewTile[]): ResolvedRoutePreviewTile[] | null {
  const resolved: ResolvedRoutePreviewTile[] = []
  for (const tile of tiles) {
    const uri = resolvedUris.get(tileKey(tile))
    if (!uri) return null
    resolved.push({ ...tile, uri })
  }
  return resolved
}

export function useRoutePreviewTiles(
  points: RoutePoint[],
  width: number,
  height: number,
  enabled: boolean,
): ResolvedRoutePreviewTile[] | null {
  const tiles = useMemo(
    () =>
      enabled && points.length >= 2
        ? routePreviewTiles(points, width, height, PixelRatio.get())
        : [],
    [enabled, height, points, width],
  )
  const loaded = useSyncExternalStore(subscribe, getVersion)

  useEffect(() => {
    tiles.forEach((tile) => void requestTile(tile))
  }, [tiles])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (tiles.length === 0 ? null : resolveAll(tiles)), [tiles, loaded])
}
