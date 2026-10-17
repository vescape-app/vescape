// THROWAWAY: UI-thread readout. Gestures never send per-frame values through React.
import { useMemo } from 'react'
import { Platform, StyleSheet } from 'react-native'
import { Canvas, matchFont, Text as SkiaText } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'
import { useSkiaMonoFont } from '@/hooks/useSkiaFont'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

export function TuneRingLiveValue({
  values,
  index,
  min,
  max,
  step,
}: {
  values: SharedValue<number[]>
  index: number
  min: number
  max: number
  step: number
}) {
  'use no memo'
  const loadedFont = useSkiaMonoFont('700', 25)
  const fallbackFont = useMemo(
    () =>
      matchFont({
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        fontSize: 25,
        fontWeight: 'bold',
      }),
    [],
  )
  const font = loadedFont ?? fallbackFont
  const neutral = useResolvedNeutralColors()
  // Monospace advance is measured once on render, never shaped on gesture frames.
  const advance = font.getGlyphWidths(font.getGlyphIDs('0'))[0]
  const text = useDerivedValue(() => {
    const raw = min + Math.round(((values.value[index] / 100) * (max - min)) / step) * step
    return String(Number(Math.max(min, Math.min(max, raw)).toFixed(3)))
  })
  const x = useDerivedValue(() => (130 - text.value.length * advance) / 2)
  return (
    <Canvas style={styles.value} pointerEvents="none" accessible={false}>
      <SkiaText x={x} y={25} text={text} font={font} color={neutral.textPrimary} />
    </Canvas>
  )
}
const styles = StyleSheet.create({ value: { width: 130, height: 32 } })
