import { afterEach, describe, expect, mock, test } from 'bun:test'

import type { DeviceTokenExchange } from './deviceAuth'
import { stopAccountAndDelete, stopAccountAndSignOut } from './accountTeardown'
import {
  isDeviceProvisioningSuspended,
  resumeDeviceProvisioning,
  startDeviceProvisioning,
} from './deviceProvisioning'

const issued: DeviceTokenExchange = { accountId: 'account-1', deviceToken: 'device-token' }

afterEach(() => resumeDeviceProvisioning())

describe('Account deletion teardown', () => {
  test('clears the Device Token before DELETE and keeps provisioning suspended once accepted', async () => {
    const calls: string[] = []
    const result = await stopAccountAndDelete({
      clearCredential: () => {
        expect(isDeviceProvisioningSuspended()).toBe(true)
        calls.push('clear')
      },
      deleteAccount: async () => {
        calls.push('delete')
      },
    })

    expect(result).toBe('accepted')
    expect(calls).toEqual(['clear', 'delete'])
    expect(isDeviceProvisioningSuspended()).toBe(true)
  })

  test('a failed credential clear never calls DELETE and resumes provisioning', async () => {
    const deleteAccount = mock(async () => undefined)
    const result = await stopAccountAndDelete({
      clearCredential: () => {
        throw new Error('keystore')
      },
      deleteAccount,
    })

    expect(result).toBe('credential-clear-failed')
    expect(deleteAccount).not.toHaveBeenCalled()
    expect(isDeviceProvisioningSuspended()).toBe(false)
  })

  test('a failed DELETE resumes provisioning so the session can exchange a fresh Device Token', async () => {
    const install = mock(async (_body: DeviceTokenExchange) => undefined)
    const steps = { getToken: async () => 'clerk-token', exchange: async () => issued, install }
    await startDeviceProvisioning('session-1', steps)

    const result = await stopAccountAndDelete({
      clearCredential: () => undefined,
      deleteAccount: async () => {
        throw new Error('500')
      },
    })

    expect(result).toBe('delete-failed')
    expect(isDeviceProvisioningSuspended()).toBe(false)
    await startDeviceProvisioning('session-1', steps)
    expect(install).toHaveBeenCalledTimes(2)
  })
})

describe('Sign-out teardown', () => {
  test('revokes and clears the Device Token before Clerk sign-out while provisioning is suspended', async () => {
    const calls: string[] = []
    await stopAccountAndSignOut({
      revokeCredential: async () => {
        expect(isDeviceProvisioningSuspended()).toBe(true)
        calls.push('revoke')
      },
      signOut: async () => {
        expect(isDeviceProvisioningSuspended()).toBe(true)
        calls.push('signOut')
      },
    })

    expect(calls).toEqual(['revoke', 'signOut'])
  })

  test('a failed revoke keeps the Clerk session and resumes provisioning', async () => {
    const signOut = mock(async () => undefined)
    await expect(
      stopAccountAndSignOut({
        revokeCredential: async () => {
          throw new Error('offline')
        },
        signOut,
      }),
    ).rejects.toThrow('offline')

    expect(signOut).not.toHaveBeenCalled()
    expect(isDeviceProvisioningSuspended()).toBe(false)
  })
})
