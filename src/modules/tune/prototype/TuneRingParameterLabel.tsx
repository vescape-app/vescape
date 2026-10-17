import { useRef, type RefObject } from 'react'
import { Pressable, StyleSheet, type View, type StyleProp, type ViewStyle } from 'react-native'
import { Text } from '@/components/base/Text'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import type { SharedValue } from 'react-native-reanimated'
import { TuneRingLiveValue } from './TuneRingLiveValue'

export function TuneRingParameterLabel({
  label,
  placement,
  description,
  value,
  liveValues,
  index,
  range,
  color,
  style,
  onPress,
}: {
  label: string
  placement: 'top' | 'bottom'
  description?: string
  value: number
  liveValues: SharedValue<number[]>
  index: number
  range: { min: number; max: number; step: number }
  color: string
  style: StyleProp<ViewStyle>
  onPress: (ref: RefObject<View | null>) => void
}) {
  const ref = useRef<View>(null)
  const neutral = useResolvedNeutralColors()
  return (
    <Pressable
      ref={ref}
      style={[styles.root, style]}
      onPress={() => onPress(ref)}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}${description ? ', edit exact value' : ''}`}
    >
      {placement === 'bottom' && (
        <TuneRingLiveValue
          values={liveValues}
          index={index}
          min={range.min}
          max={range.max}
          step={range.step}
        />
      )}
      <Text style={[styles.label, { color, fontSize: description ? 15 : 11 }]}>{label}</Text>
      {description ? (
        <Text style={[styles.description, { color: neutral.textMuted }]}>{description}</Text>
      ) : null}
      {placement === 'top' && (
        <TuneRingLiveValue
          values={liveValues}
          index={index}
          min={range.min}
          max={range.max}
          step={range.step}
        />
      )}
    </Pressable>
  )
}
const styles = StyleSheet.create({
  root: { position: 'absolute', alignItems: 'center', gap: 3 },
  label: { fontWeight: '700', textAlign: 'center', lineHeight: 19 },
  description: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
})
