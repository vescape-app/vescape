import { getDeviceCredentialState } from 'vescape-core'

import { useFriendRidesStore } from '@/modules/group-ride/store/friendRidesStore'
import { useRodeWithStore } from '@/modules/group-ride/store/rodeWithStore'
import { useDeviceAuthStore } from '@/modules/profile/store/deviceAuthStore'
import { useFriendsStore } from '@/modules/profile/store/friendsStore'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'

/** The account the native credential speaks for — the same source the account Sync components load from. */
function viewer(): string | null {
  try {
    const credential = getDeviceCredentialState()
    return credential.state === 'ready' ? credential.accountId : null
  } catch {
    // Unreadable credentials cannot authorize cached account data.
    return null
  }
}

// Seeded from native so a launch that is already signed in does not clear the first loads.
let previous = viewer()
useDeviceAuthStore.subscribe(() => {
  const current = viewer()
  if (current === previous) return
  previous = current
  useFriendRidesStore.getState().clear()
  useRodeWithStore.getState().clear()
  useFriendsStore.getState().clear()
  useRiderProfileStore.getState().clear()
})
