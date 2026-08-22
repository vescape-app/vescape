import { create } from 'zustand'

export type DeviceAuthStatus = 'idle' | 'provisioning' | 'ready' | 'failed'

/**
 * A different Vescape Account signed in on a phone whose local database belongs to another one.
 * Native refuses to bind until the Rider confirms, so this carries what the confirmation needs.
 */
export interface PendingAccountReset {
  serverUrl: string
  deviceToken: string
  accountId: string
}

interface DeviceAuthState {
  status: DeviceAuthStatus
  error: string | null
  retryRequestId: number
  /** Non-null while the destructive Account-change warning is waiting on the Rider. */
  pendingAccountReset: PendingAccountReset | null
  setStatus: (status: DeviceAuthStatus, error?: string | null) => void
  setPendingAccountReset: (pending: PendingAccountReset | null) => void
  retry: () => void
}

/**
 * UI projection of native credential provisioning.
 *
 * Native remains durable truth for the credential itself. This store only lets the account widget
 * show progress/failure and ask DeviceAuthSync to retry the Clerk → Device Token exchange.
 */
export const useDeviceAuthStore = create<DeviceAuthState>((set) => ({
  status: 'idle',
  error: null,
  retryRequestId: 0,
  pendingAccountReset: null,
  setStatus: (status, error = null) => set({ status, error }),
  setPendingAccountReset: (pendingAccountReset) => set({ pendingAccountReset }),
  retry: () => set((state) => ({ retryRequestId: state.retryRequestId + 1 })),
}))
