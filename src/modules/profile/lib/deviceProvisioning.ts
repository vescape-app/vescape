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
let installing: Promise<unknown> | null = null
let suspended = false
let generation = 0
const attemptedSessionIds = new Set<string>()

export function startDeviceProvisioning(
  sessionId: string,
  steps: DeviceProvisioningSteps,
): Promise<void> | null {
  if (suspended || provisioning !== null || attemptedSessionIds.has(sessionId)) return null
  attemptedSessionIds.add(sessionId)
  const run = provision(steps, generation)
    .catch((error: unknown) => {
      attemptedSessionIds.delete(sessionId)
      throw error
    })
    .finally(() => {
      if (provisioning === run) provisioning = null
    })
  provisioning = run
  return run
}

export async function suspendDeviceProvisioning(): Promise<void> {
  suspended = true
  generation++
  provisioning = null
  await Promise.allSettled([installing])
}

export function resumeDeviceProvisioning(): void {
  suspended = false
  attemptedSessionIds.clear()
}

export function isDeviceProvisioningSuspended(): boolean {
  return suspended
}

async function provision(
  { getToken, exchange, install }: DeviceProvisioningSteps,
  startedIn: number,
): Promise<void> {
  const clerkToken = await getToken()
  if (startedIn !== generation) throw new DeviceProvisioningSuspendedError()
  if (!clerkToken) throw new Error('Clerk session token is unavailable')
  const body = await exchange(clerkToken)
  if (startedIn !== generation) throw new DeviceProvisioningSuspendedError()
  const run = install(body)
  installing = run
  try {
    await run
  } finally {
    if (installing === run) installing = null
  }
}
