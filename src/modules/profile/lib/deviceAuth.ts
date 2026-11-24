export interface DeviceTokenExchange {
  accountId: string
  deviceToken: string
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `APP_VERSION_HEADER`
// @parity /modules/vescape-core/ios/appstatus/AppStatusCoordinator.swift `appVersionHeader`
const APP_VERSION_HEADER = 'Vescape-App-Version'

interface ExchangeDeviceTokenOptions {
  serverUrl: string
  clerkToken: string
  appVersion: string
  fetcher?: Fetcher
}

export async function exchangeDeviceToken({
  serverUrl,
  clerkToken,
  appVersion,
  fetcher = fetch,
}: ExchangeDeviceTokenOptions): Promise<DeviceTokenExchange> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  const response = await fetcher(`${serverUrl.replace(/\/+$/, '')}/api/auth/device-tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${clerkToken}`,
      [APP_VERSION_HEADER]: appVersion,
    },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout))

  if (!response.ok) throw new Error(`Device credential exchange failed (${response.status})`)
  const body: unknown = await response.json()
  if (!isExchangeResponse(body)) throw new Error('Device credential exchange response is invalid')
  return body
}

function isExchangeResponse(value: unknown): value is DeviceTokenExchange {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.accountId === 'string' && typeof record.deviceToken === 'string'
}

type AccountDeletionOutcome = 'deleted' | 'queued'

interface DeleteAccountOptions {
  serverUrl: string
  clerkToken: string
  appleAuthorizationCode?: string
  fetcher?: Fetcher
}

export async function deleteAccount({
  serverUrl,
  clerkToken,
  appleAuthorizationCode,
  fetcher = fetch,
}: DeleteAccountOptions): Promise<AccountDeletionOutcome> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  const headers: Record<string, string> = { Authorization: `Bearer ${clerkToken}` }
  let body: string | undefined
  if (appleAuthorizationCode) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify({ appleAuthorizationCode })
  }
  const response = await fetcher(`${serverUrl.replace(/\/+$/, '')}/api/account`, {
    method: 'DELETE',
    headers,
    ...(body === undefined ? {} : { body }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout))

  if (response.status === 200) return 'deleted'
  if (response.status === 202) return 'queued'
  throw new Error(`Account deletion failed (${response.status})`)
}
