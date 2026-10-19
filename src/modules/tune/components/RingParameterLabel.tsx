import { useRef, type RefObject } from 'react'
import { Pressable, type View, type StyleProp, type ViewStyle } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'
import { Text } from '@/components/base/Text'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { RING_CONTROLS, type projectRingControl } from '../lib/ringModel'
import { TuneRingLiveValue } from './RingLiveValue'

const DESCRIPTIONS = [
  'Overall response underfoot',
  'Lowers the nose when braking',
  'Lifts the nose when accelerating',
  'Turn Tilt application · Brake Tilt release',
  'More lean-back → less extra nose lift',
  'Nose down ← neutral → nose up',
  'Faster ATR application at higher ERPM',
  'Nose lowering on descents',
  'Nose lift on climbs',
]

export function RingParameterLabel({
  control,
  projection,
  liveValues,
  index,
  color,
  style,
  disabled,
  onOpen,
}: {
  control: number
  projection: ReturnType<typeof projectRingControl>
  liveValues: SharedValue<number[]>
  index: number
  color: string
  style: StyleProp<ViewStyle>
  disabled: boolean
  onOpen: (control: number, ref: RefObject<View | null>) => void
}) {
  const ref = useRef<View>(null)
  const neutral = useResolvedNeutralColors()
  const status = projection.unavailable
    ? 'Missing'
    : projection.custom
      ? projection.outOfRange
        ? 'Custom · out of range'
        : 'Custom · approximate'
      : null
  const readout = projection.unavailable ? null : (
    <TuneRingLiveValue
      values={liveValues}
      index={index}
      min={control === 5 ? -5 : 0}
      max={control === 5 ? 5 : 10}
      step={0.1}
    />
  )
  return (
    <Pressable
      ref={ref}
      testID={`ring-control-${control}`}
      accessibilityRole="button"
      accessibilityLabel={`${RING_CONTROLS[control].label}, ${projection.unavailable ? 'Missing' : (projection.value - (control === 5 ? 5 : 0)).toFixed(1)}${status ? `, ${status}` : ''}, edit exact value`}
      disabled={disabled || projection.unavailable}
      onPress={() => onOpen(control, ref)}
      style={[{ position: 'absolute', alignItems: 'center', gap: 3, minHeight: 48 }, style]}
    >
      {index !== 0 ? readout : null}
      <Text style={{ color, fontSize: 15, lineHeight: 19, fontWeight: '700', textAlign: 'center' }}>
        {RING_CONTROLS[control].label}
      </Text>
      <Text style={{ color: neutral.textMuted, fontSize: 12, lineHeight: 17, textAlign: 'center' }}>
        {DESCRIPTIONS[control]}
      </Text>
      {index === 0 ? readout : null}
      {projection.unavailable ? (
        <Text style={{ color: neutral.textMuted, fontSize: 11, textAlign: 'center' }}>
          No value
        </Text>
      ) : null}
    </Pressable>
  )
}
