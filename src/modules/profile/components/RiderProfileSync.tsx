import { useEffect } from 'react'

import { useDeviceAccountReady } from '@/modules/profile/hooks/useDeviceAccountReady'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'

/** Loads the Rider Profile once the Device Token is ready and forgets it when it goes away. */
export function RiderProfileSync() {
  const ready = useDeviceAccountReady()
  useEffect(() => {
    const store = useRiderProfileStore.getState()
    if (ready) void store.load()
    else store.clear()
  }, [ready])
  return null
}
