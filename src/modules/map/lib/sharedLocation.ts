/**
 * Location payloads exchanged with other apps, in both directions.
 *
 * Incoming share text is written by whatever app the rider shared from, so nothing here trusts its
 * shape: a payload either yields a coordinate this file recognises, or it yields nothing. A name is
 * carried along when one is readable, but the coordinate is the authoritative part — a Direction
 * Point is a place on the map, not a label.
 */
export interface SharedLocation {
  latitude: number
  longitude: number
  /** Presentation only. Null whenever the payload carried no readable label. */
  name: string | null
}

const COORD = String.raw`(-?\d{1,3}(?:\.\d+)?)`
const SEP = String.raw`(?:,|%2C)`

/**
 * Coordinate shapes, most specific first. A Google Maps URL carries several of these at once
 * (`@` viewport centre, `!3d/!4d` place pin, `q=`), and they do not agree — the pin is the shared
 * place, the viewport centre is only where the camera happened to sit, so pin forms win.
 */
const COORDINATE_PATTERNS: readonly RegExp[] = [
  // geo:0,0?q=lat,lng — the Android convention for "this place", where the leading pair is a
  // placeholder and only the query carries the real coordinate.
  new RegExp(String.raw`geo:0(?:\.0+)?,0(?:\.0+)?\?q=${COORD}${SEP}${COORD}`, 'i'),
  new RegExp(String.raw`geo:${COORD}${SEP}${COORD}`, 'i'),
  // Google Maps place pin, as it appears in a full /maps/place/ URL.
  new RegExp(String.raw`!3d${COORD}!4d${COORD}`, 'i'),
  // OpenStreetMap marker and hash.
  new RegExp(String.raw`[?&]mlat=${COORD}(?:&|&amp;)mlon=${COORD}`, 'i'),
  new RegExp(String.raw`#map=\d+(?:\.\d+)?\/${COORD}\/${COORD}`, 'i'),
  // Query parameters used by Google Maps URLs, Apple Maps and most "open this place" links.
  new RegExp(
    String.raw`[?&](?:q|query|ll|sll|daddr|saddr|destination|center)=(?:loc:)?${COORD}${SEP}${COORD}`,
    'i',
  ),
  // Google Maps viewport centre. Last of the URL forms: it is the camera, not the pin.
  new RegExp(String.raw`@${COORD}${SEP}${COORD}`, 'i'),
  // A bare pair the rider pasted or another app shared as plain text.
  new RegExp(String.raw`(?:^|\s)${COORD}\s*,\s*${COORD}(?:\s|$)`),
]

const NAME_PATTERNS: readonly RegExp[] = [
  // geo:…?q=lat,lng(Name)
  /\?q=[^()\s]*\(([^)]+)\)/i,
  // https://…/maps/place/Some+Place/@…
  /\/maps\/place\/([^/@?#]+)/i,
  // A q= that holds a label rather than a coordinate.
  /[?&](?:q|query)=(?!(?:loc:)?-?\d{1,3}(?:\.\d+)?(?:,|%2C))([^&#\s]+)/i,
]

/**
 * Reads a coordinate out of arbitrary shared text: a bare link, a link inside a sentence, a
 * `geo:` URI, or a pasted pair. Returns null when nothing usable is in there, which is the whole
 * answer — an unreadable payload must not become a guessed Direction Point.
 */
export function parseSharedLocation(input: string): SharedLocation | null {
  const text = input.trim()
  if (!text) return null

  for (const pattern of COORDINATE_PATTERNS) {
    const match = pattern.exec(text)
    if (!match) continue
    const latitude = Number(match[1])
    const longitude = Number(match[2])
    if (!isCoordinate(latitude, longitude)) continue
    return { latitude, longitude, name: parseSharedLocationName(text) }
  }
  return null
}

function parseSharedLocationName(text: string): string | null {
  for (const pattern of NAME_PATTERNS) {
    const match = pattern.exec(text)
    const raw = match?.[1]
    if (!raw) continue
    const name = decodeShareComponent(raw).replace(/\s+/g, ' ').trim()
    if (name) return name
  }
  return null
}

function decodeShareComponent(value: string): string {
  const spaced = value.replace(/\+/g, ' ')
  try {
    return decodeURIComponent(spaced)
  } catch {
    // Share text is other apps' output; a stray `%` is their bug, not a reason to lose the name.
    return spaced
  }
}

function isCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  )
}

/** ~11 cm — past any precision a map target has, and short enough to stay readable. */
const SHARE_PRECISION = 6

/**
 * A link every map app can open. This is the documented cross-platform Maps URL form: Android
 * offers it to whichever map apps are installed, and iOS hands `google.com/maps/search` links to
 * Apple Maps as a coordinate search. Vescape is not part of the resulting flow, by design.
 */
export function sharedLocationUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${formatCoordinate(latitude)},${formatCoordinate(longitude)}`
}

/**
 * What leaves Vescape through the system share sheet. The plain coordinate line is deliberate: it
 * survives being pasted into a chat, and it is what the receiving app parses when it has no
 * opinion about the link.
 */
export function sharedLocationMessage(location: SharedLocation): string {
  const coordinates = `${formatCoordinate(location.latitude)}, ${formatCoordinate(location.longitude)}`
  const url = sharedLocationUrl(location.latitude, location.longitude)
  const name = location.name?.trim()
  return name ? `${name}\n${coordinates}\n${url}` : `${coordinates}\n${url}`
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(SHARE_PRECISION)).toString()
}
