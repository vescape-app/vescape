import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { theme } from '@/constants/theme'

export function ChartLoadingOverlay() {
  return (
    <View pointerEvents="none" style={styles.overlay}>
      <ActivityIndicator size="small" color={theme.palette.sky.color} />
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
