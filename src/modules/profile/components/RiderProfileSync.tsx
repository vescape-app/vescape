import { useEffect } from 'react'

import { useDeviceAccountId } from '@/modules/profile/hooks/useDeviceAccountReady'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'

/** Loads the Rider Profile once the Device Token is ready and forgets it when it goes away. */
export function RiderProfileSync() {
  const ready = useDeviceAccountId()
  useEffect(() => {
    const store = useRiderProfileStore.getState()
    if (ready) void store.load()
    else store.clear()
  }, [ready])
  return null
}
