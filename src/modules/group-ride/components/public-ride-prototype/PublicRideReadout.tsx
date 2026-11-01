import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { Canvas, Text as SkiaText } from '@shopify/react-native-skia'
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated'
import { useSkiaFont } from '@/hooks/useSkiaFont'
import { PUBLIC_MODES, PUBLIC_RIDE_DURATIONS, publicRideDurationLabel } from './fixtures'

export const HOUR_TITLES = ['Off', ...PUBLIC_RIDE_DURATIONS.map(publicRideDurationLabel), 'Always']
export const HOUR_DESCRIPTIONS = [
  'Your location is hidden',
  ...PUBLIC_RIDE_DURATIONS.map((hours) =>
    hours >= 48
      ? `Visible for ${hours / 24} days`
      : `Visible for ${hours} ${hours === 1 ? 'hour' : 'hours'}`,
  ),
  PUBLIC_MODES[3].subtitle,
]
const TIME_PREFIX = 'Visible for '
export interface PublicRideReadoutState {
  sector: number
  title: string
  description: string
  rotation: number
  timed: boolean
}

/** Premeasure text on JS once; Skia paints detent changes without text-input or React commits. */
export function PublicRideReadout({
  readout,
  description = false,
  accent,
  muted,
}: {
  readout: SharedValue<PublicRideReadoutState>
  description?: boolean
  accent: string
  muted: string
}) {
  'use no memo'
  const height = description ? 22 : 16
  const font = useSkiaFont(description ? '600' : '700', description ? 16 : 12)
  const canvasSize = useSharedValue({ width: 0, height })
  const layout = useMemo(() => {
    if (!font) return null
    const strings = description
      ? [...HOUR_DESCRIPTIONS, ...PUBLIC_MODES.map((option) => option.subtitle)]
      : [...HOUR_TITLES, 'Timer']
    const measure = (text: string) =>
      font.getGlyphWidths(font.getGlyphIDs(text)).reduce((sum, width) => sum + width, 0)
    const widths = Object.fromEntries(strings.map((text) => [text, measure(text)]))
    const numberWidths = Object.fromEntries(
      PUBLIC_RIDE_DURATIONS.map((hours) => {
        const value = String(hours >= 48 ? hours / 24 : hours)
        return [value, measure(value)]
      }),
    )
    const { ascent, descent } = font.getMetrics()
    return {
      widths,
      prefixWidth: measure(TIME_PREFIX),
      numberWidths,
      baseline: height / 2 - (ascent + descent) / 2,
    }
  }, [font, description, height])
  const fullText = useDerivedValue(() =>
    description ? readout.get().description : readout.get().title,
  )
  const baseText = useDerivedValue(() =>
    description && readout.get().timed ? TIME_PREFIX : fullText.get(),
  )
  const timeText = useDerivedValue(() =>
    description && readout.get().timed
      ? fullText.get().slice(TIME_PREFIX.length).split(' ')[0]
      : '',
  )
  const unitText = useDerivedValue(() =>
    description && readout.get().timed ? ` ${fullText.get().split(' ').at(-1)}` : '',
  )
  const x = useDerivedValue(
    () => (canvasSize.get().width - (layout?.widths[fullText.get()] ?? 0)) / 2,
  )
  const timeX = useDerivedValue(() => x.get() + (layout?.prefixWidth ?? 0))
  const unitX = useDerivedValue(() => timeX.get() + (layout?.numberWidths[timeText.get()] ?? 0))
  const color = useDerivedValue(() => (!description && readout.get().timed ? accent : muted))
  return (
    <View
      accessible
      accessibilityLabel={
        description ? 'Selected visibility duration' : 'Selected sharing duration'
      }
      style={description ? styles.description : styles.label}
    >
      <Canvas pointerEvents="none" style={{ height }} onSize={canvasSize}>
        {font && layout ? (
          <>
            <SkiaText text={baseText} x={x} y={layout.baseline} font={font} color={color} />
            {description ? (
              <>
                <SkiaText
                  text={timeText}
                  x={timeX}
                  y={layout.baseline}
                  font={font}
                  color={accent}
                />
                <SkiaText text={unitText} x={unitX} y={layout.baseline} font={font} color={muted} />
              </>
            ) : null}
          </>
        ) : null}
      </Canvas>
    </View>
  )
}
const styles = StyleSheet.create({
  label: { width: 70 },
  description: { marginTop: -22, marginBottom: 10 },
})
