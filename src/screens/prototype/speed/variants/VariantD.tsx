/** PROTOTYPE — Variant D: "Heads-up". Full-bleed trace fills the screen edge to edge with the
 * live value floating over it as a HUD chip; alerts arrive as a docked sheet you can pull into
 * with a handle, so setup never competes with the ride view. */
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  BellRingingIcon,
  CaretDownIcon,
  CaretUpIcon,
  PencilSimpleIcon,
} from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { IconButton } from '@/components/base/IconButton'
import { theme } from '@/constants/theme'
import { MetricDetailChart } from '@/modules/board/components/MetricDetailChart'

import {
  BigReadout,
  HeroBack,
  LEVELS,
  SPEED,
  TestButton,
  describeSpec,
  useDisplayValue,
  useSpeedAlertModel,
  type VariantProps,
} from '../kit'

export function VariantD({ controller, live, points, windowMs, excludedRanges }: VariantProps) {
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const model = useSpeedAlertModel(controller)
  const value = useDisplayValue(live, model.alertTest)
  const [open, setOpen] = useState(true)

  const traceHeight = Math.max(240, height * 0.45)

  return (
    <View style={styles.root}>
      <View style={[styles.hud, { paddingTop: insets.top + 4 }]} pointerEvents="box-none">
        <HeroBack />
        <View style={styles.flex} />
        <View style={styles.chip}>
          <BigReadout value={value} size={34} width={62} />
          <Text style={styles.chipUnit}>{SPEED.unit}</Text>
        </View>
      </View>

      <View style={[styles.trace, { paddingTop: insets.top + 52 }]}>
        <MetricDetailChart
          metric={SPEED}
          points={points}
          range={{ y: SPEED.chartRange }}
          windowMs={windowMs}
          excludedRanges={excludedRanges}
          height={traceHeight}
        />
        {model.markers.map((marker) => (
          <View key={marker.id} style={styles.bandLegend}>
            <View style={styles.bandDash} />
            <Text style={styles.bandText}>{marker.label}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + 64 }]}>
        <Pressable style={styles.handleRow} onPress={() => setOpen((v) => !v)}>
          <View style={styles.handle} />
        </Pressable>

        <View style={styles.sheetHead}>
          <BellRingingIcon size={18} color={theme.palette.yellow.color} weight="duotone" />
          <Text style={styles.sheetTitle}>Alerts</Text>
          <Text style={styles.sheetLevel}>
            {LEVELS.find((l) => l.id === model.level)?.label ?? 'Custom'}
          </Text>
          <View style={styles.flex} />
          <Pressable onPress={() => setOpen((v) => !v)} hitSlop={10}>
            {open ? (
              <CaretDownIcon size={18} color={theme.palette.slate.textMuted} weight="bold" />
            ) : (
              <CaretUpIcon size={18} color={theme.palette.slate.textMuted} weight="bold" />
            )}
          </Pressable>
        </View>

        {open ? (
          <ScrollView contentContainerStyle={styles.sheetBody}>
            <View style={styles.levelRow}>
              {LEVELS.map((level) => {
                const on = level.id === model.level
                return (
                  <Pressable
                    key={level.id}
                    onPress={() => controller?.setLevel(level.id)}
                    style={[
                      styles.level,
                      on && { borderColor: level.tone.color, backgroundColor: level.tone.bg },
                    ]}
                  >
                    <Text
                      style={[
                        styles.levelLabel,
                        { color: on ? level.tone.color : theme.palette.slate.textMuted },
                      ]}
                    >
                      {level.label}
                    </Text>
                    <Text style={styles.levelHint}>{level.hint}</Text>
                  </Pressable>
                )
              })}
            </View>

            <Text style={styles.note}>
              {model.specs.length === 0
                ? 'Speed alerts are off.'
                : model.specs
                    .map((spec) => {
                      const d = describeSpec(spec, model.max)
                      return `Warns ${d.range}, ${d.cadence}.`
                    })
                    .join(' ')}
            </Text>

            <View style={styles.actions}>
              <TestButton alertTest={model.alertTest} size="md" />
              <IconButton
                icon={PencilSimpleIcon}
                accessibilityLabel="Edit alerts"
                onPress={() => controller?.customize()}
              />
            </View>
          </ScrollView>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.palette.slate.bg },
  flex: { flex: 1 },
  hud: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.alpha(theme.telemetry.speed, 0.4),
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
  },
  chipUnit: { color: theme.palette.slate.textMuted, fontSize: 11, marginBottom: 8 },
  trace: { paddingHorizontal: 4, flex: 1, justifyContent: 'center' },
  bandLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  bandDash: { width: 14, height: 1, backgroundColor: theme.palette.yellow.color },
  bandText: { color: theme.palette.yellow.color, fontSize: 11, fontWeight: '700' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
    paddingHorizontal: 16,
  },
  handleRow: { alignItems: 'center', paddingVertical: 8 },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: theme.palette.slate.border },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 8 },
  sheetTitle: { color: theme.palette.slate.textPrimary, fontSize: 18, fontWeight: '700' },
  sheetLevel: { color: theme.palette.slate.textMuted, fontSize: 12, fontWeight: '700' },
  sheetBody: { gap: 12, paddingBottom: 8 },
  levelRow: { flexDirection: 'row', gap: 8 },
  level: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    gap: 2,
  },
  levelLabel: { fontSize: 13, fontWeight: '800' },
  levelHint: { color: theme.palette.slate.textMuted, fontSize: 10 },
  note: { color: theme.palette.slate.textSecondary, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
})
