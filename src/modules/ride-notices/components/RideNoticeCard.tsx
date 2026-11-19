import { useEffect, type ReactNode } from 'react'
import { InfoIcon, MapPinIcon, WarningIcon, WarningOctagonIcon, XIcon } from 'phosphor-react-native'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import type { RideNotice } from 'vescape-core'

import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { theme, type ThemeColor } from '@/constants/theme'
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

/** The colors a notice wears: a severity's, or the hue of what it is about. */
export interface RideNoticeTone {
  color: ThemeColor
  text: ThemeColor
}

/** How a notice about something the screen knows (a rider's signal) shows instead of by severity. */
export interface RideNoticeLook {
  /** Drawn in the pulsing badge, about 30 pt. */
  icon: ReactNode
  tone: RideNoticeTone
  title: string
  /** Who or what it is about, first on the meta line. */
  subject: string
}

interface RideNoticeCardProps {
  notice: RideNotice
  /** How many more notices are active behind this one. */
  moreCount: number
  /** The rider's latest position; distance is hidden without it. */
  ownLocation: { latitude: number; longitude: number } | null
  onDismiss: (id: number, rev: number) => void
  /** Present when the screen can focus the map; hidden for a notice without a location. */
  onShowOnMap?: (location: { latitude: number; longitude: number }) => void
  look?: RideNoticeLook | null
  style?: StyleProp<ViewStyle>
}

/** The top Ride Notice: severity, title, details, age, and for a located notice its distance. */
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
  const distanceUnit = useDistanceUnit()
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

  // Any tap answers the notice: it is gone, and the map shows where it happened when it can.
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
      {/* A faint wash of the tone: the kind reads at a glance without painting the card. */}
      <View style={[styles.wash, { backgroundColor: theme.alpha(tone.color, 0.1) }]} />
      <NoticeBadge color={tone.color}>
        {look?.icon ?? <severity.Icon size={22} color={tone.color} weight="fill" />}
      </NoticeBadge>
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

const BADGE = 40

/** The notice's icon on a ring that keeps pulsing outward while the notice is up: it is live. */
function NoticeBadge({ color, children }: { color: ThemeColor; children: ReactNode }) {
  const pulse = useSharedValue(0)
  useEffect(() => {
    pulse.set(withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1))
  }, [pulse])
  const ring = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - pulse.get()),
    transform: [{ scale: 1 + 0.45 * pulse.get() }],
  }))
  return (
    <View style={styles.badge}>
      <Animated.View style={[styles.ring, { borderColor: color }, ring]} />
      <View style={[styles.disc, { backgroundColor: theme.alpha(color, 0.12) }]}>{children}</View>
    </View>
  )
}

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
  badge: {
    width: BADGE,
    height: BADGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    ...StyleSheet.absoluteFill,
    borderRadius: BADGE / 2,
    borderWidth: 2,
  },
  disc: {
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
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
