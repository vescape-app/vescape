import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { theme } from '@/constants/theme'

/** Spinner over the map while a ride range is being read from native. */
export function HistoryMapLoading() {
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <ActivityIndicator size="small" color={theme.palette.sky.color} />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    zIndex: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.alpha(theme.palette.slate.bg, 0.6),
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    transform: [{ translateX: -17 }, { translateY: -17 }],
  },
})
