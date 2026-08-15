/** PROTOTYPE — Variant C: "Bento". No single hero — the screen is a tile board: live speed, the
 * session's max/avg, the alert tile, and the trace tile, each sized by how much it matters.
 * Alerts get the widest tile and the only coloured frame on the board. */
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BellRingingIcon, GaugeIcon, TrendUpIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { MetricDetailChart } from '@/modules/board/components/MetricDetailChart'

import {
  BigReadout,
  HeroBack,
  LEVELS,
  LinearGauge,
  SPEED,
  TestButton,
  describeSpec,
  useDisplayValue,
  useSpeedAlertModel,
  type VariantProps,
} from '../kit'

export function VariantC({ controller, live, points, windowMs, excludedRanges }: VariantProps) {
  const insets = useSafeAreaInsets()
  const model = useSpeedAlertModel(controller)
  const value = useDisplayValue(live, model.alertTest)

  const values = points.map((p) => p.value)
  const max = values.length ? Math.max(...values) : null
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
  const fmt = (n: number | null) => (n == null ? '—' : Math.round(n).toString())

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 4 }]}
    >
      <View style={styles.head}>
        <HeroBack label="Speed" />
      </View>

      <View style={styles.grid}>
        <View style={[styles.tile, styles.tileLive]}>
          <Text style={styles.tileKicker}>NOW</Text>
          <BigReadout value={value} size={68} width={140} />
          <Text style={styles.tileUnit}>{SPEED.unit}</Text>
          <View style={styles.tileBar}>
            <LinearGauge value={value} max={model.max} markers={model.markers} height={8} />
          </View>
        </View>

        <View style={styles.statCol}>
          <View style={[styles.tile, styles.tileStat]}>
            <TrendUpIcon size={16} color={theme.palette.green.color} weight="duotone" />
            <Text style={styles.statValue}>{fmt(max)}</Text>
            <Text style={styles.statLabel}>max in window</Text>
          </View>
          <View style={[styles.tile, styles.tileStat]}>
            <GaugeIcon size={16} color={theme.palette.cyan.color} weight="duotone" />
            <Text style={styles.statValue}>{fmt(avg)}</Text>
            <Text style={styles.statLabel}>avg</Text>
          </View>
        </View>
      </View>

      <View style={[styles.tile, styles.tileAlerts]}>
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
                style={[styles.chip, on && { borderColor: level.tone.color }]}
              >
                <Text
                  style={[
                    styles.chipLabel,
                    { color: on ? level.tone.color : theme.palette.slate.textMuted },
                  ]}
                >
                  {level.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
        <Text style={styles.alertsNote}>
          {model.specs.length === 0
            ? 'Speed says nothing.'
            : model.specs
                .map((spec) => {
                  const d = describeSpec(spec, model.max)
                  return `${d.range} · ${d.cadence}`
                })
                .join('  ·  ')}
        </Text>
      </View>

      <View style={[styles.tile, styles.tileChart]}>
        <Text style={styles.tileKicker}>TRACE</Text>
        <MetricDetailChart
          metric={SPEED}
          points={points}
          range={{ y: SPEED.chartRange }}
          windowMs={windowMs}
          excludedRanges={excludedRanges}
          height={140}
        />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center' },
  grid: { flexDirection: 'row', gap: 10 },
  tile: {
    borderRadius: 18,
    backgroundColor: theme.palette.slate.surface,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    padding: 14,
  },
  tileLive: { flex: 1.5, gap: 2 },
  statCol: { flex: 1, gap: 10 },
  tileStat: { flex: 1, gap: 2, justifyContent: 'center' },
  tileAlerts: { gap: 12, borderColor: theme.alpha(theme.palette.yellow.color, 0.4) },
  tileChart: { gap: 8, paddingHorizontal: 10 },
  tileKicker: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  tileUnit: { color: theme.palette.slate.textSecondary, fontSize: 12, fontWeight: '600' },
  tileBar: { marginTop: 10 },
  statValue: { color: theme.palette.slate.textPrimary, fontSize: 26, fontWeight: '700' },
  statLabel: { color: theme.palette.slate.textMuted, fontSize: 11 },
  alertsHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alertsTitle: { color: theme.palette.slate.textPrimary, fontSize: 18, fontWeight: '700' },
  levelRow: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabel: { fontSize: 13, fontWeight: '800' },
  alertsNote: { color: theme.palette.slate.textSecondary, fontSize: 12 },
})
