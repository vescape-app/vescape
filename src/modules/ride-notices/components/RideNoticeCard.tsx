import type { ReactNode } from 'react'
import { InfoIcon, MapPinIcon, WarningIcon, WarningOctagonIcon, XIcon } from 'phosphor-react-native'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import type { RideNotice } from 'vescape-core'

import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { theme, type ThemeColor } from '@/constants/theme'
import { fmtTimeAgo } from '@/helpers/format'
import { distanceMeters } from '@/helpers/mapGeometry'
import { formatDistanceMeters } from '@/helpers/units'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import { useMinuteNow } from '@/hooks/useMinuteNow'

const SEVERITY = {
  critical: { Icon: WarningOctagonIcon, tone: theme.status.error },
  warning: { Icon: WarningIcon, tone: theme.status.warning },
  info: { Icon: InfoIcon, tone: theme.status.info },
} as const

export interface RideNoticeTone {
  color: ThemeColor
  text: ThemeColor
}

export interface RideNoticeLook {
  icon: ReactNode
  tone: RideNoticeTone
  title: string
  subject: string
}

interface RideNoticeCardProps {
  notice: RideNotice
  moreCount: number
  ownLocation: { latitude: number; longitude: number } | null
  onDismiss: (id: number, rev: number) => void
  onShowOnMap?: (location: { latitude: number; longitude: number }) => void
  look?: RideNoticeLook | null
  style?: StyleProp<ViewStyle>
}

export function RideNoticeCard({
  notice,
  moreCount,
  ownLocation,
  onDismiss,
  onShowOnMap,
  look = null,
  style,
}: RideNoticeCardProps) {
  const now = useMinuteNow()
  const { distanceUnit } = useUserPreferences()
  const severity = SEVERITY[notice.severity]
  const tone = look?.tone ?? severity.tone
  const target = notice.location
    ? { latitude: notice.location.lat, longitude: notice.location.lng }
    : null
  const distance =
    target && ownLocation
      ? formatDistanceMeters(distanceMeters(ownLocation, target), distanceUnit)
      : null
  const meta = [
    look?.subject,
    fmtTimeAgo(notice.postedAt, now),
    distance ? `${distance} away` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const open = () => {
    if (target && onShowOnMap) onShowOnMap(target)
    onDismiss(notice.id, notice.rev)
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={target && onShowOnMap ? 'Shows it on the map' : 'Dismisses it'}
      onPress={open}
      style={[
        styles.card,
        { backgroundColor: theme.neutral.surface, borderColor: theme.alpha(tone.color, 0.4) },
        style,
      ]}
    >
      <View style={[styles.wash, { backgroundColor: theme.alpha(tone.color, 0.1) }]} />
      <View style={styles.icon}>
        {look?.icon ?? <severity.Icon size={28} color={tone.color} weight="fill" />}
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {look?.title ?? notice.title}
        </Text>
        {notice.details ? (
          <Text style={styles.details} numberOfLines={3}>
            {notice.details}
          </Text>
        ) : null}
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
          {moreCount > 0 ? (
            <Text style={[styles.more, { color: tone.text }]}>{`  +${moreCount}`}</Text>
          ) : null}
        </Text>
      </View>
      {target && onShowOnMap ? (
        <IconButton
          icon={MapPinIcon}
          accent={tone.color}
          accessibilityLabel="Show on map"
          onPress={open}
        />
      ) : null}
      <IconButton
        icon={XIcon}
        variant="ghost"
        accessibilityLabel="Dismiss notice"
        onPress={() => onDismiss(notice.id, notice.rev)}
      />
    </Pressable>
  )
}

const ICON = 36

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 6,
    gap: 12,
  },
  icon: {
    width: ICON,
    height: ICON,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  wash: {
    ...StyleSheet.absoluteFill,
    borderRadius: 15,
  },
  title: {
    fontSize: 16,
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
    color: theme.neutral.textSecondary,
  },
  more: {
    fontWeight: '700',
  },
})
