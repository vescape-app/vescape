import { type ReactNode, useCallback, useState } from 'react'
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Text } from '@/components/base/Text'
import type { DualGaugeAlert } from '@/components/charts/gaugeAlert'
import { interaction, theme } from '@/constants/theme'
import { getLinearGaugeValueSlot } from '@/components/charts/linearGaugeLayout'
import {
  BAR_H,
  BAR_H_COMPACT,
  LINE_THICK,
  MARKER_RATIO,
  VALUE_GAP,
  GaugeBar,
  fractionOf,
} from '@/components/charts/LinearGaugeBar'
import { DASH } from '@/helpers/format'

function useBarWidth() {
  const [width, setWidth] = useState(0)
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width
    setWidth((prev) => (prev === w ? prev : w))
  }, [])
  return { width, onLayout }
}

// Charging particles: tiny dots drifting left → right along the line, absorbed
// at the head marker. Uniform size; wide speed spread + stratified phases keep
// the stream desynced instead of clumping into one group. Count scales with
// travel span so long bars don't look sparse and short ones don't crowd.
interface LinearGaugeProps {
  /** Current value, or null when unknown. */
  value: number | null
  min?: number
  max: number
  /** Stroke + value-text color (caller-resolved, e.g. low-battery warning). */
  color: string
  unit: string
  decimals?: number
  alerts?: DualGaugeAlert[]
  /** Secondary readout shown muted on the left (e.g. pack voltage). */
  aux?: ReactNode
  /** Shown when value is null. */
  hint?: string
  /** Animates particles flowing into the head marker while true. */
  charging?: boolean
  compact?: boolean
  transparent?: boolean
  containerStyle?: StyleProp<ViewStyle>
  onPress?: () => void
  testID?: string
}

export function LinearGauge({
  value,
  min = 0,
  max,
  color,
  unit,
  decimals = 0,
  alerts = [],
  aux,
  hint,
  charging = false,
  compact,
  transparent,
  containerStyle,
  onPress,
  testID,
}: LinearGaugeProps) {
  const { width, onLayout } = useBarWidth()
  const height = compact ? BAR_H_COMPACT : BAR_H
  const fraction = value == null ? 0 : fractionOf(value, min, max)
  const valueText =
    value == null ? DASH : decimals === 0 ? Math.round(value).toString() : value.toFixed(decimals)

  // The value rides just left of the head, its top aligned with the head marker's top.
  // Below 20% there's no room on the left, so it flips to the right of the head.
  const headX = width * fraction
  const valueSlot = getLinearGaugeValueSlot({ width, headX, compact, gap: VALUE_GAP })
  const valueSlotTop = height - LINE_THICK - height * MARKER_RATIO

  const content = (
    <>
      <View style={[styles.barArea, { height }]} onLayout={onLayout}>
        {width > 0 ? (
          <GaugeBar
            width={width}
            height={height}
            fraction={fraction}
            color={color}
            alerts={alerts}
            min={min}
            max={max}
            charging={charging && value != null}
          />
        ) : null}
        {value != null && width > 0 ? (
          <View style={[styles.valueSlot, valueSlot, { top: valueSlotTop }]} pointerEvents="none">
            <Text
              style={[styles.value, compact && styles.valueCompact, { color }]}
              numberOfLines={1}
            >
              {valueText}
              <Text style={styles.unit}>{unit}</Text>
            </Text>
          </View>
        ) : null}
        {value == null && hint ? <Text style={styles.hintCenter}>{hint}</Text> : null}
      </View>
      {aux != null ? (
        <View style={styles.underRow}>
          {typeof aux === 'string' ? <Text style={styles.auxText}>{aux}</Text> : aux}
        </View>
      ) : null}
    </>
  )

  const style = [
    styles.wrap,
    compact && styles.wrapCompact,
    transparent && styles.wrapTransparent,
    containerStyle,
  ]

  if (!onPress) {
    return (
      <View testID={testID} style={style}>
        {content}
      </View>
    )
  }

  return (
    <Pressable onPress={onPress} android_ripple={interaction.ripple} testID={testID} style={style}>
      {content}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginHorizontal: 4,
    marginBottom: 6,
    gap: 6,
  },
  wrapCompact: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginHorizontal: 0,
    marginBottom: 0,
    gap: 4,
  },
  wrapTransparent: {
    backgroundColor: 'transparent',
  },
  barArea: {
    width: '100%',
    position: 'relative',
  },
  // Sits in [0, head − gap], right-aligned, so the value ends just left of the head marker.
  valueSlot: {
    position: 'absolute',
    left: 0,
    bottom: LINE_THICK,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    overflow: 'hidden',
  },
  value: {
    fontSize: 16,
    fontFamily: 'monospace',
    fontWeight: '700',
    lineHeight: 18,
  },
  valueCompact: {
    fontSize: 14,
    lineHeight: 16,
  },
  unit: {
    fontSize: 9,
    fontWeight: '500',
  },
  underRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -4,
  },
  auxText: {
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  hintCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: LINE_THICK,
    textAlignVertical: 'center',
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
})
