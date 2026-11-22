import {
  ONE_DARK_BASE_LAYERS,
  ONE_DARK_SOURCES,
} from '../src/modules/map/constants/oneDarkBaseLayers'

const STYLE_NAME = 'Vescape Thumbnail Dark'
const API = 'https://api.mapbox.com/styles/v1'

const secretToken = process.env.MAPBOX_SECRET_TOKEN
if (!secretToken) {
  console.error('Set MAPBOX_SECRET_TOKEN (styles:list, styles:read, styles:write).')
  process.exit(1)
}
const owner = tokenOwner(secretToken)

const style = {
  version: 8,
  name: STYLE_NAME,
  sources: ONE_DARK_SOURCES,
  layers: ONE_DARK_BASE_LAYERS,
}

const existing = await request<{ id: string; name: string }[]>('GET', `${API}/${owner}`)
const current = existing.find((candidate) => candidate.name === STYLE_NAME)
const published = current
  ? await request<{ id: string }>('PATCH', `${API}/${owner}/${current.id}`, style)
  : await request<{ id: string }>('POST', `${API}/${owner}`, style)

console.log(`${current ? 'Updated' : 'Created'} ${owner}/${published.id}`)
console.log('Native MapTiles reads this as its style path.')

const publicToken = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN
if (publicToken) {
  const tile = await fetch(
    `${API}/${owner}/${published.id}/tiles/512/0/0/0.jpeg?access_token=${publicToken}`,
  )
  console.log(`Static tile with the app token: HTTP ${tile.status}`)
}

function tokenOwner(token: string): string {
  const payload = token.split('.')[1]
  const account = payload
    ? (JSON.parse(Buffer.from(payload, 'base64url').toString()).u as unknown)
    : null
  if (typeof account !== 'string') throw new Error('Cannot read the account name from the token')
  return account
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(`${url}?access_token=${secretToken}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok)
    throw new Error(`${method} ${url}: HTTP ${response.status} ${await response.text()}`)
  return (await response.json()) as T
}
