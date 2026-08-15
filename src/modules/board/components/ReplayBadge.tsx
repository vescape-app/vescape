import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

/**
 * Marks the connection UI while the active Board Session is a dev-mode Debug Recording replay
 * (synthetic `replay:` board id, ADR 0024).
 */
export function ReplayBadge() {
  return (
    <View testID="replay-badge" style={styles.badge}>
      <Text style={styles.text}>REPLAY</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: theme.status.warning.bg,
    borderWidth: 1,
    borderColor: theme.status.warning.border,
  },
  text: {
    color: theme.status.warning.color,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
})
