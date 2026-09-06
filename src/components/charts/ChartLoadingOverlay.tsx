import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { theme } from '@/constants/theme'

/**
 * Spinner over a chart whose series is still being handed over. Covers the plot area only, so
 * the chart's own header (label, current value, axes) stays readable and the layout never jumps
 * when the data lands.
 */
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
