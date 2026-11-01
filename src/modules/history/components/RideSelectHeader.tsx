import { StyleSheet, View } from 'react-native'
import { XIcon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useRideSelectStore } from '@/modules/history/store/rideSelectStore'

interface RideSelectHeaderProps {
  selectedCount: number
  /** Every ride the active filter matches, loaded or not. */
  matchingTotal: number
}

/** Select mode's drawer header: leave, count, Select all / Select none. */
export function RideSelectHeader({ selectedCount, matchingTotal }: RideSelectHeaderProps) {
  const { exit, start, selectAll } = useRideSelectStore.getState()
  const allTicked = matchingTotal > 0 && selectedCount >= matchingTotal
  return (
    <View style={styles.row}>
      <IconButton
        icon={XIcon}
        accessibilityLabel="Leave select mode"
        testID="ride-select-exit"
        onPress={exit}
      />
      <Text style={styles.title}>{`${selectedCount} selected`}</Text>
      <Button
        label={allTicked ? 'Select none' : `Select all (${matchingTotal})`}
        size="sm"
        variant="secondary"
        disabled={matchingTotal === 0}
        testID="ride-select-all"
        onPress={() => (allTicked ? start() : selectAll())}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  title: { flex: 1, color: theme.neutral.textPrimary, fontSize: 16, fontWeight: '700' },
})
