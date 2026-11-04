import { ScrollView, StyleSheet } from 'react-native'

import { theme } from '@/constants/theme'
import { RideStatsSection } from '@/modules/profile/screens/RideStatsSection'
import { openRecordRide } from '@/screens/profileStats/openRecordRide'

/** Profile stats, whose records open the ride that set them back on the main screen. */
export function ProfileStatsScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <RideStatsSection onOpenRecordRide={openRecordRide} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  content: {
    padding: 16,
  },
})
