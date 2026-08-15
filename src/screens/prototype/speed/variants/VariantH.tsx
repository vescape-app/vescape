/** PROTOTYPE — Variant H: "Ride tape". The screen is a scrollable story of the ride: the trace on
 * top, and under it every moment worth knowing about — pushback, hard slow-downs, footpad
 * releases, alerts that actually fired — as one feed. Alerts stop being settings and become
 * events you can react to ("that fired 3× today — raise it?"). */
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowBendDownRightIcon,
  BellRingingIcon,
  FlagIcon,
  FootprintsIcon,
  TrophyIcon,
  WarningOctagonIcon,
} from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { theme } from '@/constants/theme'
import { MetricDetailChart } from '@/modules/board/components/MetricDetailChart'

import { HeroBack, SPEED, TestButton, useSpeedAlertModel, type VariantProps } from '../kit'
import { MOCK_EVENTS, MOCK_RIDE, mockSpeedPoints, type RideEventKind } from '../mock'

const EVENT_STYLE: Record<RideEventKind, { icon: typeof FlagIcon; tone: string }> = {
  start: { icon: FlagIcon, tone: theme.palette.slate.textMuted },
  alert: { icon: BellRingingIcon, tone: theme.palette.yellow.color },
  max: { icon: TrophyIcon, tone: theme.palette.sky.color },
  brake: { icon: ArrowBendDownRightIcon, tone: theme.palette.blue.color },
  pushback: { icon: WarningOctagonIcon, tone: theme.palette.orange.color },
  footpad: { icon: FootprintsIcon, tone: theme.palette.purple.color },
}

export function VariantH({ controller, live, points, windowMs, excludedRanges }: VariantProps) {
  const insets = useSafeAreaInsets()
  const model = useSpeedAlertModel(controller)
  const trace = points.length > 0 ? points : mockSpeedPoints(windowMs)
  const alertCount = MOCK_EVENTS.filter((e) => e.kind === 'alert').length
  void live

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 4 }]}
    >
      <View style={styles.head}>
        <HeroBack label="This ride" />
        <View style={styles.flex} />
        <Text style={styles.headMeta}>
          {MOCK_RIDE.durationMin} min · {MOCK_RIDE.distanceKm} km
        </Text>
      </View>

      <MetricDetailChart
        metric={SPEED}
        points={trace}
        range={{ y: SPEED.chartRange }}
        windowMs={windowMs}
        excludedRanges={excludedRanges}
        height={150}
      />

      <View style={styles.statRow}>
        <Stat label="top" value={`${MOCK_RIDE.topSpeedKmh}`} />
        <Stat label="avg" value={`${MOCK_RIDE.avgSpeedKmh}`} />
        <Stat label="in warn band" value={`${MOCK_RIDE.timeInWarnBandPct}%`} />
      </View>

      <Text style={styles.sectionLabel}>MOMENTS</Text>

      <View style={styles.feed}>
        <View style={styles.spine} />
        {MOCK_EVENTS.map((event) => {
          const style = EVENT_STYLE[event.kind]
          const Icon = style.icon
          return (
            <View key={event.id} style={styles.event}>
              <View style={[styles.eventDot, { borderColor: style.tone }]}>
                <Icon size={15} color={style.tone} weight="duotone" />
              </View>
              <View style={styles.flex}>
                <View style={styles.eventHead}>
                  <Text style={styles.eventLabel}>{event.label}</Text>
                  <Text style={styles.eventTime}>{event.atMinute}:00</Text>
                </View>
                <Text style={styles.eventDetail}>{event.detail}</Text>
              </View>
            </View>
          )
        })}
      </View>

      <View style={styles.tuneCard}>
        <View style={styles.tuneHead}>
          <BellRingingIcon size={18} color={theme.palette.yellow.color} weight="duotone" />
          <Text style={styles.tuneTitle}>Your speed alert fired {alertCount}× today</Text>
        </View>
        <Text style={styles.tuneNote}>
          Both times right after a pull out of a corner, well below pushback. Want it later so it
          stops crying wolf?
        </Text>
        <View style={styles.tuneActions}>
          <Button
            label="Raise to Minimal"
            size="sm"
            variant="secondary"
            onPress={() => controller?.setLevel('minimal')}
          />
          <Button
            label="Keep it"
            size="sm"
            variant="secondary"
            onPress={() => controller?.setLevel(model.level)}
          />
          <TestButton alertTest={model.alertTest} />
        </View>
      </View>
    </ScrollView>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: 12 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headMeta: { color: theme.palette.slate.textMuted, fontSize: 12 },
  statRow: { flexDirection: 'row', gap: 22 },
  stat: { gap: 2 },
  statValue: { color: theme.palette.slate.textPrimary, fontSize: 20, fontWeight: '700' },
  statLabel: { color: theme.palette.slate.textMuted, fontSize: 11 },
  sectionLabel: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 4,
  },
  feed: { gap: 14, position: 'relative', paddingLeft: 2 },
  spine: {
    position: 'absolute',
    left: 18,
    top: 8,
    bottom: 8,
    width: 1,
    backgroundColor: theme.palette.slate.border,
  },
  event: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  eventDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.palette.slate.bg,
  },
  eventHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  eventLabel: { color: theme.palette.slate.textPrimary, fontSize: 14, fontWeight: '700' },
  eventTime: { color: theme.palette.slate.textDim, fontSize: 11 },
  eventDetail: { color: theme.palette.slate.textMuted, fontSize: 12, marginTop: 1 },
  tuneCard: {
    marginTop: 6,
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.yellow.color, 0.4),
  },
  tuneHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tuneTitle: { flex: 1, color: theme.palette.slate.textPrimary, fontSize: 15, fontWeight: '700' },
  tuneNote: { color: theme.palette.slate.textSecondary, fontSize: 12, lineHeight: 18 },
  tuneActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
})
