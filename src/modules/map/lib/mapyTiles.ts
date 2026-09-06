const MAPY_TILE_HOST = 'https://api.mapy.com'
const MAPY_TILE_MAPSET = 'outdoor'
const MAPY_TILE_LANGUAGE = 'en'

/**
 * Mapy serves each tile size as its own path segment. `256@2x` is a 512x512 image covering
 * the same ground as a 256 tile, so the source keeps `tileSize={256}` and the extra pixels
 * become display density instead of map area. There is no `@3x`, and a bare `512` is a 404.
 */
const MAPY_TILE_SIZE = '256@2x'

export function getMapyApiKey(value: string | null | undefined): string | null {
  const key = value?.trim()
  return key ? key : null
}

export function buildMapyTileUrlTemplate(apiKey: string | null | undefined): string | null {
  const key = getMapyApiKey(apiKey)
  if (!key) return null

  const params = new URLSearchParams({
    lang: MAPY_TILE_LANGUAGE,
    apikey: key,
  })

  return `${MAPY_TILE_HOST}/v1/maptiles/${MAPY_TILE_MAPSET}/${MAPY_TILE_SIZE}/{z}/{x}/{y}?${params}`
}
