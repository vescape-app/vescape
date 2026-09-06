import { ScrollView, StyleSheet } from 'react-native'

import { theme } from '@/constants/theme'
import { RideStatsSection } from '@/modules/profile/screens/RideStatsSection'

export function ProfileStatsScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <RideStatsSection />
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
