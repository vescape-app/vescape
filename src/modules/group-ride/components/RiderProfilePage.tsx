import { router, useLocalSearchParams } from 'expo-router'
import { ScrollView, StyleSheet } from 'react-native'

import { theme } from '@/constants/theme'
import { FriendRides } from '@/modules/group-ride/components/FriendRides'
import { OwnRiderLiveRide } from '@/modules/group-ride/components/OwnRiderLiveRide'
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

  function showMap() {
    useGroupRideStore.setState({ restoreSocialAfterProfile: false })
    router.dismissTo(routes.home)
  }

  return (
    <ScrollView
      testID="social-rider-profile"
      style={styles.page}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <RiderProfileCard
        key={accountId}
        accountId={accountId}
        seen={
          ownProfile ??
          friend ??
          (rosterRider ? { nick: rosterRider.name, nationality: null } : null)
        }
        status={
          rosterRider?.presence && !rosterRider.stale && !rosterRider.away ? 'Live' : undefined
        }
        afterStats={friend ? <FriendRides accountId={accountId} onOpen={showMap} /> : null}
      >
        {ownProfile ? (
          <OwnRiderLiveRide />
        ) : rosterRider?.presence ? (
          <RiderLiveRide
            readings={rosterRider.presence}
            stale={rosterRider.stale || rosterRider.away}
            lastSeen={rosterRider.lastSeen}
            onShowOnMap={() => {
              useGroupRideStore.getState().focusRider(accountId)
              showMap()
            }}
          />
        ) : null}
      </RiderProfileCard>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 16, paddingBottom: 32 },
})
