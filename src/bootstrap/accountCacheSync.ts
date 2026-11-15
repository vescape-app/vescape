import { getDeviceCredentialState } from 'vescape-core'

import { useFriendRidesStore } from '@/modules/group-ride/store/friendRidesStore'
import { useRodeWithStore } from '@/modules/group-ride/store/rodeWithStore'
import { useDeviceAuthStore } from '@/modules/profile/store/deviceAuthStore'
import { useFriendsStore } from '@/modules/profile/store/friendsStore'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'

let previous: string | null = null
useDeviceAuthStore.subscribe((state) => {
  let viewer: string | null = null
  try {
    const credential = getDeviceCredentialState()
    if (state.status === 'ready' && credential.state === 'ready') viewer = credential.accountId
  } catch {
    // Unreadable credentials cannot authorize cached account data.
  }
  if (viewer === previous) return
  previous = viewer
  useFriendRidesStore.getState().clear()
  useRodeWithStore.getState().clear()
  useFriendsStore.getState().clear()
  useRiderProfileStore.getState().clear()
})
