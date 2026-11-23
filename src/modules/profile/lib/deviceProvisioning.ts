import type { DeviceTokenExchange } from '@/modules/profile/lib/deviceAuth'

export interface DeviceProvisioningSteps {
  getToken: () => Promise<string | null>
  exchange: (clerkToken: string) => Promise<DeviceTokenExchange>
  install: (exchange: DeviceTokenExchange) => Promise<unknown>
}

export class DeviceProvisioningSuspendedError extends Error {
  constructor() {
    super('Device credential provisioning is suspended during account deletion')
  }
}

let provisioning: Promise<void> | null = null
let suspended = false

export function startDeviceProvisioning(steps: DeviceProvisioningSteps): Promise<void> | null {
  if (suspended || provisioning !== null) return null
  const run = provision(steps).finally(() => {
    if (provisioning === run) provisioning = null
  })
  provisioning = run
  return run
}

export async function suspendDeviceProvisioning(): Promise<void> {
  suspended = true
  await Promise.allSettled([provisioning])
}

export function resumeDeviceProvisioning(): void {
  suspended = false
}

export function isDeviceProvisioningSuspended(): boolean {
  return suspended
}

async function provision({ getToken, exchange, install }: DeviceProvisioningSteps): Promise<void> {
  const clerkToken = await getToken()
  if (suspended) throw new DeviceProvisioningSuspendedError()
  if (!clerkToken) throw new Error('Clerk session token is unavailable')
  const body = await exchange(clerkToken)
  if (suspended) throw new DeviceProvisioningSuspendedError()
  await install(body)
}
