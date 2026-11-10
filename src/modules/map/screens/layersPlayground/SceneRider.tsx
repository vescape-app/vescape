import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

/** Spike #657/#658: rider marker body shared by the MapLibre and Mapbox layer scenes. */
export function SceneRider({ index, color }: { index: number; color: string }) {
  return (
    <View style={styles.rider}>
      <View style={[styles.riderDot, { backgroundColor: color }]} />
      <Text style={styles.riderLabel}>{`Rider ${index}`}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  rider: { alignItems: 'center', gap: 2 },
  riderDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.palette.mono.white,
  },
  riderLabel: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.7),
    color: theme.palette.mono.white,
    fontSize: 10,
    fontWeight: '800',
  },
})
