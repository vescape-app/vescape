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
import { interaction, theme, type ThemeColor } from '@/constants/theme'
import { useResolvedColor } from '@/hooks/useTheme'
import { getLinearGaugeValueSlot } from '@/components/charts/linearGaugeLayout'
import {
  BAR_H,
  BAR_H_COMPACT,
  LINE_THICK,
  BAND_RATIO,
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

interface LinearGaugeProps {
  value: number | null
  min?: number
  max: number
  color: ThemeColor
  unit: string
  decimals?: number
  alerts?: DualGaugeAlert[]
  aux?: ReactNode
  hint?: string
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
  const resolvedColor = useResolvedColor(color)
  const { width, onLayout } = useBarWidth()
  const height = compact ? BAR_H_COMPACT : BAR_H
  const fraction = value == null ? 0 : fractionOf(value, min, max)
  const valueText =
    value == null ? DASH : decimals === 0 ? Math.round(value).toString() : value.toFixed(decimals)

  const headX = width * fraction
  const valueSlot = getLinearGaugeValueSlot({ width, headX, compact, gap: VALUE_GAP })
  const valueSlotTop = height - LINE_THICK - height * BAND_RATIO

  const content = (
    <>
      <View style={[styles.barArea, { height }]} onLayout={onLayout}>
        {width > 0 ? (
          <GaugeBar
            width={width}
            height={height}
            fraction={fraction}
            color={resolvedColor}
            alerts={alerts}
            min={min}
            max={max}
            charging={charging && value != null}
          />
        ) : null}
        {value != null && width > 0 ? (
          <View style={[styles.valueSlot, valueSlot, { top: valueSlotTop }]} pointerEvents="none">
            <Text
              style={[styles.value, compact && styles.valueCompact, { color: resolvedColor }]}
              numberOfLines={1}
            >
              {valueText}
              <Text style={[styles.unit, { color: resolvedColor }]}>{unit}</Text>
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

export const GAUGE_FOOTER_TEXT = {
  color: theme.neutral.textMuted,
  fontSize: 10,
  fontFamily: 'monospace',
  fontWeight: '600',
} as const

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.neutral.surface,
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
    justifyContent: 'center',
    marginTop: -4,
  },
  auxText: GAUGE_FOOTER_TEXT,
  hintCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: LINE_THICK,
    textAlignVertical: 'center',
    color: theme.neutral.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
})
