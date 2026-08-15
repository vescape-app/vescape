/** PROTOTYPE — Variant F: "Headroom". Speed alone never nosedived anyone — duty, sag and heat do.
 * This screen answers one question: how much room is left before the board stops holding you up?
 * Invented: a composite headroom meter, per-factor contribution bars, and a pushback ETA. */
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  BellRingingIcon,
  GaugeIcon,
  LightningIcon,
  ThermometerSimpleIcon,
  TimerIcon,
} from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

import {
  HeroBack,
  LEVELS,
  SPEED,
  TestButton,
  useDisplayValue,
  useSpeedAlertModel,
  BigReadout,
  type VariantProps,
} from '../kit'
import { MOCK_RIDE, MOCK_RISK } from '../mock'

/** Headroom = 100 − weighted distance travelled toward each factor's ceiling. */
function headroom() {
  const used = MOCK_RISK.reduce((sum, f) => {
    const ratio =
      f.id === 'battery'
        ? Math.min(1, Math.max(0, (100 - f.value) / (100 - f.ceiling)))
        : Math.min(1, Math.max(0, f.value / f.ceiling))
    return sum + ratio * f.weight
  }, 0)
  return Math.round((1 - used) * 100)
}

const ICONS = {
  duty: GaugeIcon,
  battery: LightningIcon,
  temp: ThermometerSimpleIcon,
  speed: TimerIcon,
} as const

const TONES = {
  duty: theme.palette.orange,
  battery: theme.palette.green,
  temp: theme.palette.red,
  speed: theme.palette.sky,
} as const

export function VariantF({ controller, live }: VariantProps) {
  const insets = useSafeAreaInsets()
  const model = useSpeedAlertModel(controller)
  const value = useDisplayValue(live, model.alertTest)
  const room = headroom()
  const tone =
    room > 55 ? theme.palette.green : room > 30 ? theme.palette.yellow : theme.palette.orange

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 4 }]}
    >
      <View style={styles.head}>
        <HeroBack label="Headroom" />
        <View style={styles.flex} />
        <Text style={styles.headMeta}>live</Text>
      </View>

      <View style={[styles.hero, { borderColor: tone.border }]}>
        <View style={styles.heroTop}>
          <Text style={[styles.heroValue, { color: tone.color }]}>{room}%</Text>
          <View style={styles.heroTexts}>
            <Text style={styles.heroTitle}>room left</Text>
            <Text style={styles.heroSub}>before the board starts pushing back</Text>
          </View>
        </View>
        <View style={styles.heroBarTrack}>
          <View style={[styles.heroBarFill, { width: `${room}%`, backgroundColor: tone.color }]} />
        </View>
        <View style={styles.etaRow}>
          <TimerIcon size={14} color={theme.palette.slate.textMuted} weight="duotone" />
          <Text style={styles.eta}>
            At this pace pushback in <Text style={styles.etaStrong}>~2 min 40 s</Text> · easing off
            5 km/h buys you 9 min
          </Text>
        </View>
      </View>

      <View style={styles.liveRow}>
        <BigReadout value={value} size={46} width={96} />
        <Text style={styles.liveUnit}>{SPEED.unit}</Text>
        <View style={styles.flex} />
        <Text style={styles.liveMeta}>
          top {MOCK_RIDE.topSpeedKmh} · avg {MOCK_RIDE.avgSpeedKmh}
        </Text>
      </View>

      <Text style={styles.sectionLabel}>WHAT IS EATING IT</Text>
      {MOCK_RISK.map((factor) => {
        const Icon = ICONS[factor.id as keyof typeof ICONS]
        const t = TONES[factor.id as keyof typeof TONES]
        const ratio =
          factor.id === 'battery'
            ? Math.min(1, Math.max(0, (100 - factor.value) / (100 - factor.ceiling)))
            : Math.min(1, Math.max(0, factor.value / factor.ceiling))
        return (
          <View key={factor.id} style={styles.factor}>
            <Icon size={18} color={t.color} weight="duotone" />
            <View style={styles.flex}>
              <View style={styles.factorHead}>
                <Text style={styles.factorLabel}>{factor.label}</Text>
                <Text style={styles.factorValue}>
                  {factor.value}
                  {factor.unit}
                  <Text style={styles.factorCeiling}>
                    {'  '}/ {factor.ceiling}
                    {factor.unit}
                  </Text>
                </Text>
              </View>
              <View style={styles.factorTrack}>
                <View
                  style={[
                    styles.factorFill,
                    { width: `${Math.round(ratio * 100)}%`, backgroundColor: t.color },
                  ]}
                />
              </View>
            </View>
            <Text style={styles.factorWeight}>{Math.round(factor.weight * 100)}%</Text>
          </View>
        )
      })}

      <View style={styles.alertsBlock}>
        <View style={styles.alertsHead}>
          <BellRingingIcon size={18} color={theme.palette.yellow.color} weight="duotone" />
          <Text style={styles.alertsTitle}>Tell me before it bites</Text>
          <View style={styles.flex} />
          <TestButton alertTest={model.alertTest} />
        </View>
        <Text style={styles.alertsNote}>
          Warn at{' '}
          <Text style={styles.alertsStrong}>
            {LEVELS.find((l) => l.id === model.level)?.label ?? 'Custom'}
          </Text>{' '}
          — that is {model.specs[0] ? `${Math.round(model.specs[0].threshold)} km/h` : 'never'}, or
          roughly 35% headroom.
        </Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: 12 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headMeta: { color: theme.palette.slate.textMuted, fontSize: 12 },
  hero: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    backgroundColor: theme.palette.slate.surface,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroValue: { fontSize: 52, fontWeight: '800' },
  heroTexts: { flex: 1, gap: 2 },
  heroTitle: { color: theme.palette.slate.textPrimary, fontSize: 17, fontWeight: '700' },
  heroSub: { color: theme.palette.slate.textMuted, fontSize: 12, lineHeight: 16 },
  heroBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
    overflow: 'hidden',
  },
  heroBarFill: { height: '100%', borderRadius: 4 },
  etaRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  eta: { flex: 1, color: theme.palette.slate.textSecondary, fontSize: 12, lineHeight: 17 },
  etaStrong: { color: theme.palette.slate.textPrimary, fontWeight: '700' },
  liveRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingTop: 4 },
  liveUnit: { color: theme.palette.slate.textMuted, fontSize: 12, marginBottom: 10 },
  liveMeta: { color: theme.palette.slate.textMuted, fontSize: 12, marginBottom: 10 },
  sectionLabel: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 4,
  },
  factor: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  factorHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  factorLabel: { color: theme.palette.slate.textPrimary, fontSize: 13, fontWeight: '600' },
  factorValue: { color: theme.palette.slate.textSecondary, fontSize: 12, fontWeight: '700' },
  factorCeiling: { color: theme.palette.slate.textDim, fontWeight: '500' },
  factorTrack: {
    height: 5,
    borderRadius: 3,
    marginTop: 5,
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
    overflow: 'hidden',
  },
  factorFill: { height: '100%', borderRadius: 3 },
  factorWeight: { color: theme.palette.slate.textDim, fontSize: 11, width: 30, textAlign: 'right' },
  alertsBlock: {
    marginTop: 8,
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.yellow.color, 0.4),
  },
  alertsHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alertsTitle: { color: theme.palette.slate.textPrimary, fontSize: 16, fontWeight: '700' },
  alertsNote: { color: theme.palette.slate.textSecondary, fontSize: 12, lineHeight: 18 },
  alertsStrong: { color: theme.palette.slate.textPrimary, fontWeight: '800' },
})
