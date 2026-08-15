/** PROTOTYPE — Variant J: "Ride card". What you'd actually want on the phone you pull out at a
 * stop: how far can I still go, how smooth was I, and one honest line about what to change.
 * Invented: a smoothness score from throttle/pitch variance, range with a confidence band, and
 * a "get home" mode that trades top speed for kilometres. */
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BellRingingIcon, HouseIcon, SparkleIcon, WindIcon } from 'phosphor-react-native'

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
import { MOCK_RIDE } from '../mock'

const SCORES = [
  { id: 'smooth', label: 'Smoothness', value: 87, tone: theme.palette.green, hint: 'steady pitch' },
  { id: 'pace', label: 'Pace', value: 64, tone: theme.palette.sky, hint: 'below your usual' },
  { id: 'margin', label: 'Margin', value: 42, tone: theme.palette.yellow, hint: 'two close calls' },
]

export function VariantJ({ controller, live }: VariantProps) {
  const insets = useSafeAreaInsets()
  const model = useSpeedAlertModel(controller)
  const value = useDisplayValue(live, model.alertTest)
  const [getHome, setGetHome] = useState(false)

  const range = getHome ? MOCK_RIDE.rangeKm * 1.34 : MOCK_RIDE.rangeKm
  const cap = getHome ? 22 : Math.round(model.max)

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 4 }]}
    >
      <View style={styles.head}>
        <HeroBack label="Ride card" />
        <View style={styles.flex} />
        <View style={styles.now}>
          <BigReadout value={value} size={28} width={50} />
          <Text style={styles.nowUnit}>{SPEED.unit}</Text>
        </View>
      </View>

      <View style={styles.rangeCard}>
        <Text style={styles.rangeKicker}>YOU CAN STILL RIDE</Text>
        <View style={styles.rangeRow}>
          <Text style={styles.rangeValue}>{range.toFixed(1)}</Text>
          <Text style={styles.rangeUnit}>km</Text>
          <Text style={styles.rangeBand}>± {MOCK_RIDE.rangeConfidenceKm} km</Text>
        </View>
        <View style={styles.rangeTrack}>
          <View style={[styles.rangeFill, { width: `${MOCK_RIDE.batteryPct}%` }]} />
          <View style={[styles.rangeBandMark, { left: `${MOCK_RIDE.batteryPct - 8}%` }]} />
        </View>
        <Text style={styles.rangeNote}>
          At {MOCK_RIDE.avgSpeedKmh} km/h average, {MOCK_RIDE.batteryPct}% left, this hill profile.
        </Text>

        <Pressable
          onPress={() => setGetHome((v) => !v)}
          style={[styles.getHome, getHome && { borderColor: theme.palette.cyan.color }]}
        >
          <HouseIcon
            size={18}
            color={getHome ? theme.palette.cyan.color : theme.palette.slate.textMuted}
            weight="duotone"
          />
          <View style={styles.flex}>
            <Text style={[styles.getHomeLabel, getHome && { color: theme.palette.cyan.color }]}>
              Get-home mode
            </Text>
            <Text style={styles.getHomeHint}>
              {getHome
                ? `Capped at ${cap} km/h · +3.8 km of range`
                : 'Cap top speed, stretch the last kilometres'}
            </Text>
          </View>
          <View style={[styles.toggle, getHome && styles.toggleOn]}>
            <View style={[styles.knob, getHome && styles.knobOn]} />
          </View>
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>HOW YOU RODE</Text>
      <View style={styles.scoreRow}>
        {SCORES.map((score) => (
          <View key={score.id} style={[styles.score, { borderColor: score.tone.border }]}>
            <Text style={[styles.scoreValue, { color: score.tone.color }]}>{score.value}</Text>
            <Text style={styles.scoreLabel}>{score.label}</Text>
            <Text style={styles.scoreHint}>{score.hint}</Text>
          </View>
        ))}
      </View>

      <View style={styles.tip}>
        <SparkleIcon size={18} color={theme.palette.purple.color} weight="duotone" />
        <Text style={styles.tipText}>
          Your two closest calls were both downhill at {MOCK_RIDE.topSpeedKmh} km/h with duty over
          75%. Same road, 3 km/h slower, and the margin score goes green.
        </Text>
      </View>

      <View style={styles.windRow}>
        <WindIcon size={16} color={theme.palette.cyan.color} weight="duotone" />
        <Text style={styles.windText}>
          Headwind 14 km/h on the way back — expect ~1.6 km less range than the number above.
        </Text>
      </View>

      <View style={styles.alertsRow}>
        <BellRingingIcon size={18} color={theme.palette.yellow.color} weight="duotone" />
        <Text style={styles.alertsText}>
          Alerts:{' '}
          <Text style={styles.alertsStrong}>
            {LEVELS.find((l) => l.id === model.level)?.label ?? 'Custom'}
          </Text>
          {model.specs[0] ? ` from ${Math.round(model.specs[0].threshold)} km/h` : ''}
        </Text>
        <View style={styles.flex} />
        <TestButton alertTest={model.alertTest} />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: 12 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  now: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  nowUnit: { color: theme.palette.slate.textMuted, fontSize: 11, marginBottom: 7 },
  rangeCard: {
    gap: 8,
    padding: 16,
    borderRadius: 18,
    backgroundColor: theme.palette.slate.surface,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
  },
  rangeKicker: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  rangeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  rangeValue: { color: theme.palette.slate.textPrimary, fontSize: 46, fontWeight: '800' },
  rangeUnit: { color: theme.palette.slate.textSecondary, fontSize: 16, fontWeight: '700' },
  rangeBand: { color: theme.palette.slate.textMuted, fontSize: 12, marginLeft: 6 },
  rangeTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
    overflow: 'hidden',
    marginTop: 2,
  },
  rangeFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: theme.alpha(theme.palette.green.color, 0.6),
  },
  rangeBandMark: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: theme.palette.slate.light,
  },
  rangeNote: { color: theme.palette.slate.textMuted, fontSize: 12 },
  getHome: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
  },
  getHomeLabel: { color: theme.palette.slate.textPrimary, fontSize: 14, fontWeight: '700' },
  getHomeHint: { color: theme.palette.slate.textMuted, fontSize: 11 },
  toggle: {
    width: 42,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleOn: { borderColor: theme.palette.cyan.color },
  knob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.palette.slate.light,
  },
  knobOn: { alignSelf: 'flex-end', backgroundColor: theme.palette.cyan.color },
  sectionLabel: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 4,
  },
  scoreRow: { flexDirection: 'row', gap: 8 },
  score: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 2,
  },
  scoreValue: { fontSize: 26, fontWeight: '800' },
  scoreLabel: { color: theme.palette.slate.textPrimary, fontSize: 12, fontWeight: '700' },
  scoreHint: { color: theme.palette.slate.textMuted, fontSize: 10 },
  tip: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingTop: 4 },
  tipText: { flex: 1, color: theme.palette.slate.textSecondary, fontSize: 12, lineHeight: 18 },
  windRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  windText: { flex: 1, color: theme.palette.slate.textMuted, fontSize: 12, lineHeight: 17 },
  alertsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.palette.slate.border,
  },
  alertsText: { color: theme.palette.slate.textSecondary, fontSize: 12 },
  alertsStrong: { color: theme.palette.slate.textPrimary, fontWeight: '800' },
})
