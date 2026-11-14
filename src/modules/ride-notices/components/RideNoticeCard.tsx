import { InfoIcon, MapPinIcon, WarningIcon, WarningOctagonIcon, XIcon } from 'phosphor-react-native'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import type { RideNotice } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { fmtTimeAgo } from '@/helpers/format'
import { distanceMeters } from '@/helpers/mapGeometry'
import { formatDistanceMeters } from '@/helpers/units'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'
import { useMinuteNow } from '@/hooks/useMinuteNow'

const SEVERITY = {
  critical: { Icon: WarningOctagonIcon, tone: theme.status.error },
  warning: { Icon: WarningIcon, tone: theme.status.warning },
  info: { Icon: InfoIcon, tone: theme.status.info },
} as const

interface RideNoticeCardProps {
  notice: RideNotice
  /** How many more notices are active behind this one. */
  moreCount: number
  /** The rider's latest position; distance is hidden without it. */
  ownLocation: { latitude: number; longitude: number } | null
  onDismiss: (id: number, rev: number) => void
  /** Present when the screen can focus the map; hidden for a notice without a location. */
  onShowOnMap?: (location: { latitude: number; longitude: number }) => void
  style?: StyleProp<ViewStyle>
}

/** The top Ride Notice: severity, title, details, age, and for a located notice its distance. */
export function RideNoticeCard({
  notice,
  moreCount,
  ownLocation,
  onDismiss,
  onShowOnMap,
  style,
}: RideNoticeCardProps) {
  const now = useMinuteNow()
  const distanceUnit = useDistanceUnit()
  const { Icon, tone } = SEVERITY[notice.severity]
  const target = notice.location
    ? { latitude: notice.location.lat, longitude: notice.location.lng }
    : null
  const distance =
    target && ownLocation
      ? formatDistanceMeters(distanceMeters(ownLocation, target), distanceUnit)
      : null
  const meta = [fmtTimeAgo(notice.postedAt, now), distance ? `${distance} away` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.neutral.surface, borderColor: tone.border },
        style,
      ]}
    >
      <View style={styles.header}>
        <Icon size={20} color={tone.color} weight="fill" />
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {notice.title}
          </Text>
          {notice.details ? (
            <Text style={styles.details} numberOfLines={3}>
              {notice.details}
            </Text>
          ) : null}
          <Text style={styles.meta}>
            {meta}
            {moreCount > 0 ? (
              <Text style={[styles.more, { color: tone.text }]}>{`  +${moreCount}`}</Text>
            ) : null}
          </Text>
        </View>
        <IconButton
          icon={XIcon}
          variant="ghost"
          accessibilityLabel="Dismiss notice"
          onPress={() => onDismiss(notice.id, notice.rev)}
        />
      </View>
      {target && onShowOnMap ? (
        <Button
          label="Show on map"
          size="sm"
          variant="secondary"
          icon={MapPinIcon}
          onPress={() => onShowOnMap(target)}
          style={styles.action}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  body: {
    flex: 1,
    gap: 3,
    paddingTop: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.neutral.textPrimary,
  },
  details: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    color: theme.neutral.textSecondary,
  },
  meta: {
    fontSize: 12,
    fontWeight: '500',
    color: theme.neutral.textDim,
  },
  more: {
    fontWeight: '700',
  },
  action: {
    alignSelf: 'flex-start',
  },
})
