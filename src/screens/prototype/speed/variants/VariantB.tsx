/** PROTOTYPE — Variant B: "One ladder". The gauge and the alert editor are literally the same
 * object: a vertical speed scale whose lit segment IS the alert band. Picking a level repaints the
 * band you are riding toward; the needle rides the same track. */
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BellRingingIcon, SlidersHorizontalIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { generateAlertPresetRules } from '@/modules/alerts/lib/alertPresets'
import { MetricDetailChart } from '@/modules/board/components/MetricDetailChart'

import {
  BigReadout,
  HeroBack,
  LEVELS,
  SPEED,
  SpeedLadder,
  TestButton,
  useDisplayValue,
  useSpeedAlertModel,
  type VariantProps,
} from '../kit'

export function VariantB({ controller, live, points, windowMs, excludedRanges }: VariantProps) {
  const insets = useSafeAreaInsets()
  const model = useSpeedAlertModel(controller)
  const value = useDisplayValue(live, model.alertTest)
  const topSpeed = controller?.topSpeedKmh ?? 0

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 4 }]}
    >
      <View style={styles.head}>
        <HeroBack label="Speed" />
        <View style={styles.flex} />
        <TestButton alertTest={model.alertTest} />
      </View>

      <View style={styles.body}>
        <SpeedLadder value={value} max={model.max} markers={model.markers} height={340} />

        <View style={styles.side}>
          <View style={styles.readout}>
            <BigReadout value={value} size={72} width={150} />
            <Text style={styles.unit}>{SPEED.unit}</Text>
          </View>

          <View style={styles.alertsHead}>
            <BellRingingIcon size={16} color={theme.palette.yellow.color} weight="duotone" />
            <Text style={styles.alertsTitle}>Warn me</Text>
          </View>

          {LEVELS.map((level) => {
            const on = level.id === model.level
            const specs = generateAlertPresetRules('speed', level.id, {
              boardTopSpeedKmh: topSpeed,
            })
            const from = specs[0] ? `${Math.round(specs[0].threshold)}+` : 'never'
            return (
              <Pressable
                key={level.id}
                onPress={() => controller?.setLevel(level.id)}
                style={[styles.levelRow, on && { borderColor: level.tone.color }]}
              >
                <View
                  style={[
                    styles.levelBar,
                    { backgroundColor: on ? level.tone.color : theme.palette.slate.border },
                  ]}
                />
                <Text
                  style={[
                    styles.levelLabel,
                    { color: on ? level.tone.color : theme.palette.slate.textSecondary },
                  ]}
                >
                  {level.label}
                </Text>
                <View style={styles.flex} />
                <Text style={styles.levelFrom}>{from}</Text>
              </Pressable>
            )
          })}

          <Pressable style={styles.custom} onPress={() => controller?.customize()}>
            <SlidersHorizontalIcon size={14} color={theme.palette.purple.color} weight="duotone" />
            <Text style={styles.customText}>Own rules</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.sectionLabel}>WHERE YOU'VE BEEN</Text>
      <MetricDetailChart
        metric={SPEED}
        points={points}
        range={{ y: SPEED.chartRange }}
        windowMs={windowMs}
        excludedRanges={excludedRanges}
        height={110}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: 14 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  body: { flexDirection: 'row', gap: 12 },
  side: { flex: 1, gap: 8 },
  readout: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginBottom: 8 },
  unit: { color: theme.palette.slate.textSecondary, fontSize: 14, fontWeight: '700', bottom: 12 },
  alertsHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  alertsTitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
  },
  levelBar: { width: 3, height: 18, borderRadius: 2 },
  levelLabel: { fontSize: 14, fontWeight: '700' },
  levelFrom: { color: theme.palette.slate.textMuted, fontSize: 12 },
  custom: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  customText: { color: theme.palette.purple.color, fontSize: 12, fontWeight: '700' },
  sectionLabel: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
})
