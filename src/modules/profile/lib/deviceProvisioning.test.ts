import { afterEach, describe, expect, mock, test } from 'bun:test'

import type { DeviceTokenExchange } from './deviceAuth'
import {
  DeviceProvisioningSuspendedError,
  resumeDeviceProvisioning,
  startDeviceProvisioning,
  suspendDeviceProvisioning,
} from './deviceProvisioning'

const issued: DeviceTokenExchange = { accountId: 'account-1', deviceToken: 'device-token' }

function deferredExchange() {
  let finish: (value: DeviceTokenExchange) => void = () => undefined
  const exchange = mock(
    (_clerkToken: string) =>
      new Promise<DeviceTokenExchange>((resolve) => {
        finish = resolve
      }),
  )
  return { exchange, finish: () => finish(issued) }
}

afterEach(() => resumeDeviceProvisioning())

describe('Device Token provisioning during account deletion', () => {
  test('an exchange in flight when deletion starts never installs its Device Token', async () => {
    const { exchange, finish } = deferredExchange()
    const install = mock(async (_body: DeviceTokenExchange) => undefined)
    const run = startDeviceProvisioning('session-1', {
      getToken: async () => 'clerk-token',
      exchange,
      install,
    })
    while (exchange.mock.calls.length === 0) await Promise.resolve()

    await suspendDeviceProvisioning()
    resumeDeviceProvisioning()
    finish()

    await expect(run).rejects.toBeInstanceOf(DeviceProvisioningSuspendedError)
    expect(install).not.toHaveBeenCalled()
  })

  test('deletion waits for an install already running so it cannot land after the local clear', async () => {
    let installed = false
    let finishInstall: () => void = () => undefined
    const install = mock(
      () =>
        new Promise<void>((resolve) => {
          finishInstall = () => {
            installed = true
            resolve()
          }
        }),
    )
    const run = startDeviceProvisioning('session-1', {
      getToken: async () => 'clerk-token',
      exchange: async () => issued,
      install,
    })
    while (install.mock.calls.length === 0) await Promise.resolve()

    let settled = false
    const suspended = suspendDeviceProvisioning().then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    finishInstall()
    await run
    await suspended
    expect(installed).toBe(true)
  })

  test('no new exchange starts while deletion runs, and provisioning resumes after a failure', async () => {
    await suspendDeviceProvisioning()
    const getToken = mock(async () => 'clerk-token')
    const install = mock(async (_body: DeviceTokenExchange) => undefined)

    expect(
      startDeviceProvisioning('session-1', { getToken, exchange: async () => issued, install }),
    ).toBeNull()
    expect(getToken).not.toHaveBeenCalled()

    resumeDeviceProvisioning()
    await startDeviceProvisioning('session-1', { getToken, exchange: async () => issued, install })
    expect(install).toHaveBeenCalledWith(issued)
  })

  test('resuming lets the same Clerk session exchange a fresh Device Token after teardown aborts', async () => {
    const install = mock(async (_body: DeviceTokenExchange) => undefined)
    const steps = { getToken: async () => 'clerk-token', exchange: async () => issued, install }
    await startDeviceProvisioning('session-1', steps)
    expect(startDeviceProvisioning('session-1', steps)).toBeNull()

    await suspendDeviceProvisioning()
    resumeDeviceProvisioning()
    await startDeviceProvisioning('session-1', steps)
    expect(install).toHaveBeenCalledTimes(2)
  })
})
