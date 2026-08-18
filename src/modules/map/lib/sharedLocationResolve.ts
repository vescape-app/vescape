import { parseSharedLocation, type SharedLocation } from '@/modules/map/lib/sharedLocation'

/**
 * Hosts that hand out a short link containing no coordinate at all. Sharing a place from Google
 * Maps produces one of these far more often than a full URL, so refusing them would mean refusing
 * the common case; the coordinate only appears once the link is followed to where it points.
 */
const SHORT_LINK_HOSTS = [
  'maps.app.goo.gl',
  'goo.gl/maps',
  'g.co/kgs',
  'maps.apple/p',
  'osm.org/go',
]

const URL_PATTERN = /https?:\/\/[^\s<>"']+/i

/** The short link inside shared text, or null when there is nothing to follow. */
export function shortLocationLink(text: string): string | null {
  const url = URL_PATTERN.exec(text)?.[0]
  if (!url) return null
  const lower = url.toLowerCase()
  return SHORT_LINK_HOSTS.some((host) => lower.includes(host)) ? url : null
}

/**
 * The coordinate behind shared text. Reads it directly when the payload carries one, and otherwise
 * follows a short link once to see where it lands — the redirect target is a full map URL, which
 * `parseSharedLocation` already understands.
 */
export async function resolveSharedLocation(
  text: string,
  options: { signal?: AbortSignal } = {},
): Promise<SharedLocation | null> {
  const direct = parseSharedLocation(text)
  if (direct) return direct

  const shortLink = shortLocationLink(text)
  if (!shortLink) return null
  try {
    const response = await fetch(shortLink, { redirect: 'follow', signal: options.signal })
    // The landing URL is the payload; its body is a page of markup we have no business reading.
    return parseSharedLocation(response.url)
  } catch {
    return null
  }
}
