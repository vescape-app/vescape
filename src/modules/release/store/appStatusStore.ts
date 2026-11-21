import { AppState } from 'react-native'
import { create } from 'zustand'

import { addAppStatusListener, getAppStatus, type AppStatus } from 'vescape-core'

interface AppStatusState {
  status: AppStatus | null
  versionNoticeDismissed: boolean
  replace: (status: AppStatus | null) => void
  dismissVersionNotice: () => void
}

export const useAppStatusStore = create<AppStatusState>((set) => ({
  status: null,
  versionNoticeDismissed: false,
  replace: (status) => set({ status }),
  dismissVersionNotice: () => set({ versionNoticeDismissed: true }),
}))

export function startAppStatusSync(): () => void {
  const project = () => useAppStatusStore.getState().replace(getAppStatus())
  const sub = addAppStatusListener((event) => useAppStatusStore.getState().replace(event.status))
  project()
  const appStateSub = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') project()
  })
  return () => {
    sub.remove()
    appStateSub.remove()
  }
}
