import { resolveSharedLocationLink } from 'vescape-core'

import { parseSharedLocation, type SharedLocation } from '@/modules/map/lib/sharedLocation'

const SHORT_LINK_HOSTS = [
  'maps.app.goo.gl',
  'goo.gl/maps',
  'g.co/kgs',
  'maps.apple/p',
  'osm.org/go',
]

const URL_PATTERN = /https?:\/\/[^\s<>"']+/i

export function shortLocationLink(text: string): string | null {
  const url = URL_PATTERN.exec(text)?.[0]
  if (!url) return null
  const lower = url.toLowerCase()
  return SHORT_LINK_HOSTS.some((host) => lower.includes(host)) ? url : null
}

/**
 * Direct coordinates stay local. Opaque provider links go native because React Native fetch hides
 * Google's redirect chain and can silently land on a consent page instead of the shared place.
 */
export async function resolveSharedLocation(
  text: string,
  options: {
    signal?: AbortSignal
    resolveLink?: (link: string) => Promise<SharedLocation | null>
  } = {},
): Promise<SharedLocation | null> {
  const direct = parseSharedLocation(text)
  if (direct) return direct

  const shortLink = shortLocationLink(text)
  if (!shortLink || options.signal?.aborted) return null
  try {
    return await (options.resolveLink ?? resolveSharedLocationLink)(shortLink)
  } catch {
    return null
  }
}
