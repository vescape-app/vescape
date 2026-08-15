import { StyleSheet, View, type ViewStyle } from 'react-native'
import Animated, {
  type AnimatedStyle,
  type DerivedValue,
  type SharedValue,
} from 'react-native-reanimated'

import { MonoValue } from '@/components/base/MonoValue'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

/** Also drives the parent chart's tooltip clamping math. */
export const TOOLTIP_WIDTH = 94

const HEADER_TIME_FONT_SIZE = 9
const HEADER_VALUE_FONT_SIZE = 11
const TOOLTIP_VALUE_FONT_SIZE = 9
const TOOLTIP_TIME_FONT_SIZE = 8

interface ChartHeaderProps {
  label?: string
  /** Time only shows while scrubbing — otherwise the header is just the value. */
  showTime: boolean
  timeText: DerivedValue<string>
  valueText: DerivedValue<string>
  valueColor: string | SharedValue<string>
}

export function ChartHeaderReadout({
  label,
  showTime,
  timeText,
  valueText,
  valueColor,
}: ChartHeaderProps) {
  return (
    <View style={styles.header}>
      {label ? <Text style={styles.label}>{label}</Text> : <View />}
      <View style={styles.headerRight}>
        {showTime && (
          <MonoValue
            text={timeText}
            size={HEADER_TIME_FONT_SIZE}
            weight="500"
            color={theme.palette.slate.textMuted}
            align="right"
            style={styles.headerTime}
          />
        )}
        <MonoValue
          text={valueText}
          size={HEADER_VALUE_FONT_SIZE}
          color={valueColor}
          align="right"
          style={styles.value}
        />
      </View>
    </View>
  )
}

interface ChartTooltipProps {
  /** Animated horizontal placement, computed by the chart against the marker. */
  style: AnimatedStyle<ViewStyle>
  timeText: DerivedValue<string>
  valueText: DerivedValue<string>
  valueColor: string | SharedValue<string>
  secondaryValueText?: DerivedValue<string>
  secondaryColor?: string
}

export function ChartTooltipReadout({
  style,
  timeText,
  valueText,
  valueColor,
  secondaryValueText,
  secondaryColor,
}: ChartTooltipProps) {
  return (
    <Animated.View style={[styles.tooltip, style]}>
      <View style={styles.tooltipValues}>
        <MonoValue
          text={valueText}
          size={TOOLTIP_VALUE_FONT_SIZE}
          color={valueColor}
          align="center"
          style={styles.tooltipValue}
        />
        {secondaryValueText && (
          <MonoValue
            text={secondaryValueText}
            size={TOOLTIP_VALUE_FONT_SIZE}
            color={secondaryColor}
            align="center"
            style={styles.tooltipValue}
          />
        )}
      </View>
      <MonoValue
        text={timeText}
        size={TOOLTIP_TIME_FONT_SIZE}
        weight="500"
        color={theme.palette.slate.textMuted}
        align="center"
        style={styles.tooltipTime}
      />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTime: {
    width: 52,
  },
  label: {
    color: theme.palette.slate.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  value: {
    // Canvases do not grow to their text: size the box for the longest readout.
    width: 92,
  },
  tooltip: {
    position: 'absolute',
    top: 2,
    width: TOOLTIP_WIDTH,
    backgroundColor: theme.palette.slate.surfaceDeep,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 1,
  },
  tooltipValues: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tooltipValue: {
    flex: 1,
  },
  tooltipTime: {
    alignSelf: 'stretch',
  },
})
