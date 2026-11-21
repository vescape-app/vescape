import { useEffect } from 'react'

import { useDeviceAccountId } from '@/modules/profile/hooks/useDeviceAccountReady'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'

export function RiderProfileSync() {
  const ready = useDeviceAccountId()
  useEffect(() => {
    const store = useRiderProfileStore.getState()
    if (ready) void store.load()
    else store.clear()
  }, [ready])
  return null
}
