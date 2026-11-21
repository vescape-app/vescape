import { create } from 'zustand'

export type DeviceAuthStatus = 'idle' | 'provisioning' | 'ready' | 'failed'

interface DeviceAuthState {
  status: DeviceAuthStatus
  error: string | null
  retryRequestId: number
  setStatus: (status: DeviceAuthStatus, error?: string | null) => void
  retry: () => void
}

export const useDeviceAuthStore = create<DeviceAuthState>((set) => ({
  status: 'idle',
  error: null,
  retryRequestId: 0,
  setStatus: (status, error = null) => set({ status, error }),
  retry: () => set((state) => ({ retryRequestId: state.retryRequestId + 1 })),
}))
