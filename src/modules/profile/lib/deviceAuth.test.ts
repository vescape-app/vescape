import { describe, expect, test } from 'bun:test'

import { deleteAccount, exchangeDeviceToken } from './deviceAuth'

describe('Device Token exchange', () => {
  test('identifies the installed app version to the Online Capability gate', async () => {
    const requests: Request[] = []
    const fetcher = (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return Promise.resolve(
        Response.json({ accountId: 'account-1', deviceToken: 'device-token' }, { status: 201 }),
      )
    }

    await exchangeDeviceToken({
      serverUrl: 'http://localhost:3000/',
      clerkToken: 'clerk-token',
      appVersion: '0.81.3',
      fetcher,
    })

    expect(requests[0]?.headers.get('Vescape-App-Version')).toBe('0.81.3')
  })
})

describe('Vescape Account deletion request', () => {
  function respondWith(status: number) {
    const requests: Request[] = []
    const fetcher = (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return Promise.resolve(new Response(null, { status }))
    }
    return { requests, fetcher }
  }

  test('deletes the account with the Clerk session token, not a Device Token', async () => {
    const { requests, fetcher } = respondWith(200)

    const outcome = await deleteAccount({
      serverUrl: 'http://localhost:3000/',
      clerkToken: 'clerk-token',
      fetcher,
    })

    expect(outcome).toBe('deleted')
    expect(requests[0]?.method).toBe('DELETE')
    expect(requests[0]?.url).toBe('http://localhost:3000/api/account')
    expect(requests[0]?.headers.get('Authorization')).toBe('Bearer clerk-token')
  })

  test('sends appleAuthorizationCode when provided for iOS Sign in with Apple revocation', async () => {
    const { requests, fetcher } = respondWith(200)

    const outcome = await deleteAccount({
      serverUrl: 'http://localhost:3000/',
      clerkToken: 'clerk-token',
      appleAuthorizationCode: 'apple-code-123',
      fetcher,
    })

    expect(outcome).toBe('deleted')
    expect(requests[0]?.headers.get('Content-Type')).toBe('application/json')
    expect(await requests[0]?.json()).toEqual({ appleAuthorizationCode: 'apple-code-123' })
  })

  test('treats 202 as accepted while the server finishes deletion in the background', async () => {
    const { fetcher } = respondWith(202)

    expect(await deleteAccount({ serverUrl: 'http://x', clerkToken: 't', fetcher })).toBe('queued')
  })

  test('rejects any other status so the rider can retry', async () => {
    for (const status of [204, 401, 500]) {
      const { fetcher } = respondWith(status)
      await expect(
        deleteAccount({ serverUrl: 'http://x', clerkToken: 't', fetcher }),
      ).rejects.toThrow(`Account deletion failed (${status})`)
    }
  })
})
