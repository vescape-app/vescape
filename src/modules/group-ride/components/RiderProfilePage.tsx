import { router, useLocalSearchParams } from 'expo-router'
import { StyleSheet } from 'react-native'

import { PageScrollView } from '@/components/base/PageScrollView'
import { theme } from '@/constants/theme'
import { FriendRides } from '@/modules/group-ride/components/FriendRides'
import { OwnRiderDeviceStatus } from '@/modules/group-ride/components/OwnRiderDeviceStatus'
import { RiderLiveRide } from '@/modules/group-ride/components/RiderLiveRide'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'
import { RiderProfileCard } from '@/modules/profile/components/RiderProfileCard'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'
import { useFriendsStore } from '@/modules/profile/store/friendsStore'
import { routes } from '@/navigation/routes'

export function RiderProfilePage() {
  const { accountId } = useLocalSearchParams<{ accountId: string }>()
  const rosterRider = useGroupRideStore((s) => s.rosterRows.find((row) => row.id === accountId))
  const ownProfile = useRiderProfileStore((s) =>
    s.profile?.accountId === accountId ? s.profile : null,
  )
  const friend = useFriendsStore((s) => s.lists.friends.find((row) => row.accountId === accountId))

  const livePresence =
    rosterRider?.presence && !rosterRider.stale && !rosterRider.away ? rosterRider.presence : null

  function showMap() {
    router.dismissTo(routes.home)
  }

  return (
    <PageScrollView
      testID="social-rider-profile"
      style={styles.page}
      contentContainerStyle={styles.content}
    >
      <RiderProfileCard
        key={accountId}
        accountId={accountId}
        seen={
          ownProfile ??
          friend ??
          (rosterRider ? { nick: rosterRider.name, nationality: null } : null)
        }
        status={!ownProfile && livePresence ? 'Live' : undefined}
        afterStats={friend ? <FriendRides accountId={accountId} onOpen={showMap} /> : null}
      >
        {ownProfile ? (
          <OwnRiderDeviceStatus />
        ) : livePresence ? (
          <RiderLiveRide
            readings={livePresence}
            onShowOnMap={() => {
              useGroupRideStore.getState().focusRider(accountId)
              showMap()
            }}
          />
        ) : null}
      </RiderProfileCard>
    </PageScrollView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 16, paddingBottom: 32 },
})
