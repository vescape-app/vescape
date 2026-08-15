import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { isDevelopmentApp } from '@/config/appVariant'
import { showDevControls } from '@/config/env'
import { theme } from '@/constants/theme'

const DEV_BADGE_HIDE_MS = 60_000

/**
 * The dev-build marker. It only exists to be noticed during development, so tapping it hides it
 * for a minute instead of taking the app somewhere — a dev build that gets in the way is useless.
 * Renders just the pill; the overlay placement is the mount point's job.
 */
export function DevBadge() {
  const [hidden, setHidden] = useState(false)
  if (!isDevelopmentApp || !showDevControls) return null

  if (hidden) return null

  return (
    <Pressable
      onPress={() => {
        setHidden(true)
        setTimeout(() => setHidden(false), DEV_BADGE_HIDE_MS)
      }}
      accessibilityRole="button"
      accessibilityLabel="Development build badge — tap to hide for one minute"
      hitSlop={8}
    >
      <View style={styles.badge}>
        <Text style={styles.text}>dev</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: theme.status.warning.color,
    borderRadius: 999,
    backgroundColor: theme.status.warning.bg,
  },
  text: {
    color: theme.status.warning.text,
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
})
