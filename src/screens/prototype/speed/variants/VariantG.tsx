/** PROTOTYPE — Variant G: "Speed envelope". Not a needle — a shape. Where did this ride actually
 * live? A histogram of time spent per speed bucket, with the alert band drawn over the same axis
 * so the level you pick is visibly "how much of my riding gets flagged". */
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BellRingingIcon, TrophyIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

import {
  BigReadout,
  HeroBack,
  LEVELS,
  SPEED,
  TestButton,
  useDisplayValue,
  useSpeedAlertModel,
  type VariantProps,
} from '../kit'
import { MOCK_HISTOGRAM, MOCK_RIDE } from '../mock'

const CHART_HEIGHT = 190

export function VariantG({ controller, live }: VariantProps) {
  const insets = useSafeAreaInsets()
  const model = useSpeedAlertModel(controller)
  const value = useDisplayValue(live, model.alertTest)

  const peak = Math.max(...MOCK_HISTOGRAM.map((b) => b.seconds))
  const total = MOCK_HISTOGRAM.reduce((sum, b) => sum + b.seconds, 0)
  const warnFrom = model.specs[0]?.threshold ?? Infinity
  const flagged = MOCK_HISTOGRAM.filter((b) => b.to > warnFrom).reduce(
    (sum, b) => sum + b.seconds,
    0,
  )
  const flaggedPct = Math.round((flagged / total) * 100)

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 4 }]}
    >
      <View style={styles.head}>
        <HeroBack label="Speed envelope" />
        <View style={styles.flex} />
        <View style={styles.now}>
          <BigReadout value={value} size={30} width={54} />
          <Text style={styles.nowUnit}>{SPEED.unit}</Text>
        </View>
      </View>

      <Text style={styles.lead}>
        {MOCK_RIDE.durationMin} min · {MOCK_RIDE.distanceKm} km. Bars are time spent; the tinted
        zone is what your alert level flags.
      </Text>

      <View style={styles.chart}>
        {MOCK_HISTOGRAM.map((bucket) => {
          const h = Math.max(4, (bucket.seconds / peak) * CHART_HEIGHT)
          const flaggedBucket = bucket.to > warnFrom
          const pct = Math.round((bucket.seconds / total) * 100)
          return (
            <View key={bucket.from} style={styles.col}>
              <Text style={styles.colPct}>{pct}%</Text>
              <View
                style={[
                  styles.bar,
                  { height: h },
                  flaggedBucket ? styles.barFlagged : styles.barNormal,
                ]}
              />
              <Text style={styles.colTick}>{bucket.from}</Text>
            </View>
          )
        })}
        <View style={[styles.pbLine, { bottom: 26 }]} />
      </View>

      <View style={styles.pbRow}>
        <TrophyIcon size={16} color={theme.palette.yellow.color} weight="duotone" />
        <Text style={styles.pbText}>
          Personal best {MOCK_RIDE.personalBestKmh} km/h · today&apos;s top {MOCK_RIDE.topSpeedKmh}{' '}
          km/h
        </Text>
      </View>

      <View style={styles.alertsBlock}>
        <View style={styles.alertsHead}>
          <BellRingingIcon size={18} color={theme.palette.yellow.color} weight="duotone" />
          <Text style={styles.alertsTitle}>Alerts</Text>
          <View style={styles.flex} />
          <TestButton alertTest={model.alertTest} />
        </View>

        <View style={styles.levelRow}>
          {LEVELS.map((level) => {
            const on = level.id === model.level
            return (
              <Pressable
                key={level.id}
                onPress={() => controller?.setLevel(level.id)}
                style={[styles.level, on && { borderColor: level.tone.color }]}
              >
                <Text
                  style={[
                    styles.levelLabel,
                    { color: on ? level.tone.color : theme.palette.slate.textMuted },
                  ]}
                >
                  {level.label}
                </Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.impact}>
          {Number.isFinite(warnFrom)
            ? `Beeps from ${Math.round(warnFrom)} km/h — that covers ${flaggedPct}% of this ride.`
            : 'Nothing flagged on this ride.'}
        </Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: 14 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  now: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  nowUnit: { color: theme.palette.slate.textMuted, fontSize: 11, marginBottom: 8 },
  lead: { color: theme.palette.slate.textSecondary, fontSize: 12, lineHeight: 17 },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    height: CHART_HEIGHT + 40,
    position: 'relative',
  },
  col: { flex: 1, alignItems: 'center', gap: 4 },
  colPct: { color: theme.palette.slate.textDim, fontSize: 10 },
  bar: { width: '100%', borderRadius: 6, borderWidth: 1 },
  barNormal: {
    backgroundColor: theme.alpha(theme.telemetry.speed, 0.3),
    borderColor: theme.alpha(theme.telemetry.speed, 0.6),
  },
  barFlagged: {
    backgroundColor: theme.alpha(theme.palette.yellow.color, 0.12),
    borderColor: theme.palette.yellow.color,
  },
  colTick: { color: theme.palette.slate.textMuted, fontSize: 10 },
  pbLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: theme.alpha(theme.palette.slate.light, 0.3),
  },
  pbRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pbText: { color: theme.palette.slate.textSecondary, fontSize: 12 },
  alertsBlock: {
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surface,
  },
  alertsHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alertsTitle: { color: theme.palette.slate.textPrimary, fontSize: 17, fontWeight: '700' },
  levelRow: { flexDirection: 'row', gap: 8 },
  level: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelLabel: { fontSize: 13, fontWeight: '800' },
  impact: { color: theme.palette.slate.textSecondary, fontSize: 12, lineHeight: 17 },
})
