import { LineLayer, ShapeSource } from '@rnmapbox/maps'
import { EyeIcon, EyeSlashIcon } from 'phosphor-react-native'
import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { interaction, theme } from '@/constants/theme'
import { useResolvedAccentColors } from '@/hooks/useTheme'
import { riderMapColor } from '@/modules/group-ride/lib/riderColor'
import { useRodeWithStore } from '@/modules/group-ride/store/rodeWithStore'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'

/** The other riders' tracks on a past ride's map, in their live colors, under `belowLayerID`. */
export function RodeWithTracks({ belowLayerID }: { belowLayerID: string }) {
  const tracks = useRodeWithStore((s) => s.tracks)
  const hidden = useRodeWithStore((s) => s.hidden)
  if (hidden) return null
  return tracks.map((track) => (
    <RiderTrackLine
      key={track.key}
      id={`rode-with-${track.key}`}
      accountId={track.accountId}
      coordinates={track.coordinates}
      belowLayerID={belowLayerID}
    />
  ))
}

/** Another rider's stored track, in their live color. */
export function RiderTrackLine({
  id,
  accountId,
  coordinates,
  belowLayerID,
}: {
  id: string
  accountId: string
  coordinates: [number, number][]
  belowLayerID?: string
}) {
  const accents = useResolvedAccentColors()
  return (
    <ShapeSource
      id={`center-${id}-source`}
      shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} }}
    >
      <LineLayer
        id={`center-${id}-line`}
        belowLayerID={belowLayerID}
        style={{
          lineColor: riderMapColor({ id: accountId, stale: false }, accents),
          lineWidth: MAP_DEFAULTS.trailWidth,
          lineOpacity: 0.85,
          lineCap: 'round',
          lineJoin: 'round',
        }}
      />
    </ShapeSource>
  )
}

/** Who the rider rode with, with the toggle that hides them from the map. Empty when alone. */
export function RodeWithRow() {
  const accents = useResolvedAccentColors()
  const riders = useRodeWithStore((s) => s.riders)
  const hidden = useRodeWithStore((s) => s.hidden)
  const toggleHidden = useRodeWithStore((s) => s.toggleHidden)
  if (riders.length === 0) return null
  const ToggleIcon = hidden ? EyeSlashIcon : EyeIcon
  return (
    <Pressable
      testID="history-rode-with"
      accessibilityRole="switch"
      accessibilityState={{ checked: !hidden }}
      accessibilityLabel={hidden ? 'Show riders on the map' : 'Hide riders on the map'}
      onPress={toggleHidden}
      android_ripple={interaction.ripple}
      style={styles.row}
    >
      <ToggleIcon size={14} color={theme.control.icon} weight="bold" />
      <Text style={styles.label}>Rode with</Text>
      <View style={styles.riders}>
        {riders.map((rider) => (
          <View key={rider.accountId} style={styles.rider}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: riderMapColor({ id: rider.accountId, stale: hidden }, accents),
                },
              ]}
            />
            <Text style={styles.nick} numberOfLines={1}>
              {rider.nick}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  label: {
    color: theme.neutral.textMuted,
    fontSize: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  riders: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 2,
  },
  rider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 140,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  nick: {
    color: theme.neutral.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
})
