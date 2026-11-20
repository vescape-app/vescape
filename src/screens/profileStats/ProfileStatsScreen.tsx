import { StyleSheet } from 'react-native'

import { PageScrollView } from '@/components/base/PageScrollView'
import { theme } from '@/constants/theme'
import { FriendRides } from '@/modules/group-ride/components/FriendRides'
import { RideStatsSection } from '@/modules/profile/screens/RideStatsSection'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'
import { openRecordRide } from '@/screens/profileStats/openRecordRide'

/** Profile stats, whose records open the ride that set them back on the main screen. */
export function ProfileStatsScreen() {
  const ownAccountId = useRiderProfileStore((s) => s.profile?.accountId ?? null)

  return (
    <PageScrollView style={styles.container} contentContainerStyle={styles.content}>
      <RideStatsSection onOpenRecordRide={openRecordRide} />
      {ownAccountId ? <FriendRides accountId={ownAccountId} /> : null}
    </PageScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
})
