import { describe, expect, test } from 'bun:test'
import {
  createReleasedVersionRequest,
  recordReleasedVersion,
  type ReleasePlatform,
} from './releasedVersion'

const request = (overrides: Partial<Parameters<typeof createReleasedVersionRequest>[0]> = {}) =>
  createReleasedVersionRequest({
    platform: 'android',
    version: '1.2.3',
    internalApiKey: 'internal-key',
    ...overrides,
  })

describe('released version request', () => {
  test('posts the platform and version to the production server', () => {
    expect(request()).toEqual({
      url: 'https://api.vescape.app/api/internal/app-status/released',
      init: {
        method: 'POST',
        headers: {
          Authorization: 'Bearer internal-key',
          'Content-Type': 'application/json',
        },
        body: '{"platform":"android","version":"1.2.3"}',
      },
    })
  })

  test('targets an explicit server without doubling its slash', () => {
    expect(request({ serverUrl: 'http://localhost:3000/' }).url).toBe(
      'http://localhost:3000/api/internal/app-status/released',
    )
  })

  test.each([
    ['a version the server would reject', { version: '1.2' }],
    ['a prerelease version', { version: '1.2.3-beta.1' }],
    ['a tag rather than a version', { version: 'v1.2.3' }],
    ['an unknown platform', { platform: 'web' as ReleasePlatform }],
    ['a missing Internal API key', { internalApiKey: '' }],
  ])('refuses %s', (_, overrides) => {
    expect(() => request(overrides)).toThrow()
  })
})

describe('recording a released version', () => {
  /** Each entry is built per call: a Response body can only be read once. */
  function respondWith(...responses: Array<() => Response | Error>) {
    const calls: string[] = []
    const fetchImpl = ((url: string) => {
      calls.push(url)
      const next = (responses[calls.length - 1] ?? responses.at(-1)!)()
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
    }) as unknown as typeof fetch
    return { calls, fetchImpl }
  }

  const ok = () => new Response('{}', { status: 200 })
  const failing =
    (status: number, body = 'error') =>
    () =>
      new Response(body, { status })

  const options = (fetchImpl: typeof fetch) => ({ fetchImpl, delayMs: 0, sleep: async () => {} })

  test('sends the request once when the server accepts it', async () => {
    const { calls, fetchImpl } = respondWith(ok)

    await recordReleasedVersion(request(), options(fetchImpl))

    expect(calls).toHaveLength(1)
  })

  // The store release already happened; a transient server error must not fail the release run.
  test('retries a server error and succeeds', async () => {
    const { calls, fetchImpl } = respondWith(failing(502, 'bad gateway'), ok)

    await recordReleasedVersion(request(), options(fetchImpl))

    expect(calls).toHaveLength(2)
  })

  test('retries a network failure', async () => {
    const { calls, fetchImpl } = respondWith(() => new Error('connect ETIMEDOUT'), ok)

    await recordReleasedVersion(request(), options(fetchImpl))

    expect(calls).toHaveLength(2)
  })

  // A rejected request is rejected the same way every time; retrying only delays the failure.
  test('does not retry a request the server refused', async () => {
    const { calls, fetchImpl } = respondWith(failing(401, 'unauthorized'))

    await expect(recordReleasedVersion(request(), options(fetchImpl))).rejects.toThrow('401')
    expect(calls).toHaveLength(1)
  })

  test('gives up after the last attempt and reports the final error', async () => {
    const { calls, fetchImpl } = respondWith(failing(503))

    await expect(recordReleasedVersion(request(), options(fetchImpl))).rejects.toThrow('503')
    expect(calls).toHaveLength(3)
  })
})
