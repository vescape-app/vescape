/**
 * Tells the Vescape server which marketing version a store now serves, so App Status stops
 * being a hand-edited number in the server repository (vescape-server ADR-0012).
 *
 * This runs where the store credentials already live. The server never talks to Google Play
 * or App Store Connect; it only accepts what a release workflow reports, authorized by the
 * Internal API key.
 */

export const PRODUCTION_SERVER_URL = 'https://api.vescape.app'
export const RELEASED_VERSION_PATH = '/api/internal/app-status/released'

export type ReleasePlatform = 'android' | 'ios'

/** Matches the server's own gate: a strict three-part marketing version, nothing else. */
const MARKETING_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export interface ReleasedVersionRequest {
  url: string
  init: {
    method: 'POST'
    headers: Record<string, string>
    body: string
  }
}

export function createReleasedVersionRequest({
  platform,
  version,
  internalApiKey,
  serverUrl = PRODUCTION_SERVER_URL,
}: {
  platform: ReleasePlatform
  version: string
  internalApiKey: string
  serverUrl?: string
}): ReleasedVersionRequest {
  if (platform !== 'android' && platform !== 'ios') {
    throw new Error(`Invalid platform "${platform}"`)
  }
  if (!MARKETING_VERSION.test(version)) {
    throw new Error(`Invalid marketing version "${version}"`)
  }
  if (internalApiKey.length === 0) throw new Error('INTERNAL_API_KEY is empty')

  return {
    url: `${serverUrl.replace(/\/+$/, '')}${RELEASED_VERSION_PATH}`,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${internalApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ platform, version }),
    },
  }
}

/**
 * A retry per attempt, because the store release has already happened by the time this runs:
 * the version is live either way, and a transient 502 must not be reported as a failed release.
 */
export async function recordReleasedVersion(
  request: ReleasedVersionRequest,
  {
    fetchImpl = fetch,
    attempts = 3,
    delayMs = 2_000,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: {
    fetchImpl?: typeof fetch
    attempts?: number
    delayMs?: number
    sleep?: (ms: number) => Promise<unknown>
  } = {},
): Promise<void> {
  let lastError = ''
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(request.url, request.init)
      if (response.ok) return
      lastError = `${response.status} ${await response.text()}`
      // The server rejected the request itself; retrying sends the same bad request again.
      if (response.status >= 400 && response.status < 500) break
    } catch (caught) {
      lastError = caught instanceof Error ? caught.message : String(caught)
    }
    if (attempt < attempts) await sleep(delayMs)
  }
  throw new Error(`Could not record the released version: ${lastError}`)
}

if (import.meta.main) {
  const [platform, version] = process.argv.slice(2)
  const internalApiKey = process.env.INTERNAL_API_KEY ?? ''
  const serverUrl = process.env.VESCAPE_SERVER_URL || PRODUCTION_SERVER_URL

  await recordReleasedVersion(
    createReleasedVersionRequest({
      platform: platform as ReleasePlatform,
      version: version ?? '',
      internalApiKey,
      serverUrl,
    }),
  )
  console.log(`Recorded ${platform} ${version} as released`)
}
