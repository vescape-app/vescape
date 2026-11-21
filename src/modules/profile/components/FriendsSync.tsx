import { useEffect } from 'react'
import { AppState } from 'react-native'

import { useDeviceAccountId } from '@/modules/profile/hooks/useDeviceAccountReady'
import { useFriendsStore } from '@/modules/profile/store/friendsStore'

const REFRESH_MS = 60_000

export function FriendsSync() {
  const ready = useDeviceAccountId()
  useEffect(() => {
    const store = useFriendsStore.getState()
    if (!ready) {
      store.clear()
      return
    }
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer) return
      void store.load()
      timer = setInterval(() => void store.load(), REFRESH_MS)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    if (AppState.currentState === 'active') start()
    const subscription = AppState.addEventListener('change', (state) =>
      state === 'active' ? start() : stop(),
    )
    return () => {
      stop()
      subscription.remove()
    }
  }, [ready])
  return null
}
