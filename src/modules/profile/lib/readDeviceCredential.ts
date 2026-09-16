import type { DeviceCredentialStatus } from 'vescape-core'

import { errorMessage } from '@/helpers/error'

/** Keep storage failures distinct from an absent credential: never provision over unreadable data. */
export function readDeviceCredential(
  read: () => DeviceCredentialStatus,
): { status: DeviceCredentialStatus; error: null } | { status: null; error: string } {
  try {
    return { status: read(), error: null }
  } catch (error) {
    return {
      status: null,
      error: errorMessage(error, 'Device credential storage is unavailable'),
    }
  }
}
