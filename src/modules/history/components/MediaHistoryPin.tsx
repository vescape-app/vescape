import { Image } from 'expo-image'
import { PlayIcon } from 'phosphor-react-native'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { InMapMarker, useInMapMarkerRefresh } from '@/components/map/InMapMarker'

import { theme } from '@/constants/theme'
import type { MediaHistoryCluster } from '@/modules/history/lib/mediaHistory'

export function MediaHistoryPin({
  cluster,
  onPress,
}: {
  cluster: MediaHistoryCluster
  onPress: () => void
}) {
  return (
    <InMapMarker coordinate={cluster.coordinate}>
      <MediaHistoryPinButton cluster={cluster} onPress={onPress} />
    </InMapMarker>
  )
}

function MediaHistoryPinButton({
  cluster,
  onPress,
}: {
  cluster: MediaHistoryCluster
  onPress: () => void
}) {
  const refresh = useInMapMarkerRefresh()
  const first = cluster.assets[0]
  const clustered = cluster.assets.length > 1
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        clustered ? `Open ${cluster.assets.length} ride media assets` : `Open ${first.mediaType}`
      }
      onPress={onPress}
      style={({ pressed }) => [styles.pin, clustered && styles.cluster, pressed && styles.pressed]}
    >
      {clustered ? (
        <Text style={styles.count}>{cluster.assets.length}</Text>
      ) : (
        <>
          <Image
            source={first.uri}
            contentFit="cover"
            style={styles.thumbnail}
            onDisplay={refresh}
          />
          {first.mediaType === 'video' ? (
            <View style={styles.videoBadge}>
              <PlayIcon size={8} color={theme.palette.purple.text} weight="fill" />
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: theme.palette.purple.color,
    backgroundColor: theme.neutral.surfaceDeep,
  },
  cluster: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.55,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  count: {
    color: theme.neutral.textPrimary,
    fontSize: 11,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  videoBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.6),
  },
})
