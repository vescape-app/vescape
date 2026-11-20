import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { Canvas, Text as SkiaText } from '@shopify/react-native-skia'
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated'
import { useSkiaFont } from '@/hooks/useSkiaFont'
import { PUBLIC_RIDE_DURATIONS, publicRideDurationLabel } from '@/modules/group-ride/lib/publicRide'

export const HOUR_TITLES = ['Off', ...PUBLIC_RIDE_DURATIONS.map(publicRideDurationLabel), 'Always']
export const HOUR_DESCRIPTIONS = [
  'Your location is hidden',
  ...PUBLIC_RIDE_DURATIONS.map((hours) =>
    hours >= 48
      ? `Visible for ${hours / 24} days`
      : `Visible for ${hours} ${hours === 1 ? 'hour' : 'hours'}`,
  ),
  'No sharing time limit',
]
const TIME_PREFIX = 'Visible for '
const END_PREFIX = 'Visible until '
export interface PublicRideReadoutState {
  sector: number
  title: string
  description: string
  rotation: number
  timed: boolean
  /** Detent: 0 off, 1… a duration from `PUBLIC_RIDE_DURATIONS`, then always. */
  stop: number
}

/** A running timer, shown in place of its duration while the dial is at rest on it. */
export interface PublicRideRunningTimer {
  /** The duration it runs for: the dial shows it only while resting on this stop. */
  hours: number
  /** Time left, for the title: `11 h 42 m`. */
  left: string
  /** When it ends, for the description: `15:42`. */
  end: string
}

/** One readout line: plain text, then an accented value, then plain text again. */
interface ReadoutParts {
  base: string
  value: string
  unit: string
}

/** Premeasure text on JS once; Skia paints detent changes without text-input or React commits. */
export function PublicRideReadout({
  readout,
  description = false,
  running = null,
  presetEnds = null,
  notice = null,
  dragging,
  accent,
  muted,
}: {
  readout: SharedValue<PublicRideReadoutState>
  description?: boolean
  running?: PublicRideRunningTimer | null
  /** When each duration preset would end if picked now, for the description while dragging. */
  presetEnds?: readonly string[] | null
  /** Replaces the description while the dial is at rest, e.g. `Connecting to server…`. */
  notice?: string | null
  dragging?: SharedValue<boolean>
  accent: string
  muted: string
}) {
  'use no memo'
  const height = description ? 22 : 16
  const font = useSkiaFont(description ? '600' : '700', description ? 16 : 12)
  const canvasSize = useSharedValue({ width: 0, height })
  const left = running?.left ?? null
  const end = running?.end ?? null
  const runningStop = running ? PUBLIC_RIDE_DURATIONS.indexOf(running.hours) + 1 : -1
  const layout = useMemo(() => {
    if (!font) return null
    const strings = description
      ? [
          ...HOUR_DESCRIPTIONS,
          TIME_PREFIX,
          END_PREFIX,
          ' hour',
          ' hours',
          ' days',
          ...PUBLIC_RIDE_DURATIONS.map((hours) => String(hours >= 48 ? hours / 24 : hours)),
          ...(end ? [end] : []),
          ...(presetEnds ?? []),
          ...(notice ? [notice] : []),
        ]
      : [...HOUR_TITLES, 'Timer', ...(left ? [left] : [])]
    const measure = (text: string) =>
      font.getGlyphWidths(font.getGlyphIDs(text)).reduce((sum, width) => sum + width, 0)
    const { ascent, descent } = font.getMetrics()
    return {
      widths: Object.fromEntries(strings.map((text) => [text, measure(text)])),
      baseline: height / 2 - (ascent + descent) / 2,
    }
  }, [font, description, height, left, end, presetEnds, notice])
  const parts = useDerivedValue<ReadoutParts>(() => {
    const state = readout.get()
    // Released on a new stop, the dial moves before native reports the new timer: keep the
    // preset until the timer matches, or the old timer's time flashes in between.
    const atRest = state.timed && !dragging?.get() && state.stop === runningStop
    if (!description) {
      return { base: atRest && left ? left : state.title, value: '', unit: '' }
    }
    if (notice && !dragging?.get()) return { base: notice, value: '', unit: '' }
    if (!state.timed) return { base: state.description, value: '', unit: '' }
    if (atRest && end) return { base: END_PREFIX, value: end, unit: '' }
    const presetEnd = presetEnds?.[state.stop - 1]
    if (presetEnd) return { base: END_PREFIX, value: presetEnd, unit: '' }
    const [value, unit] = state.description.slice(TIME_PREFIX.length).split(' ')
    return { base: TIME_PREFIX, value, unit: ` ${unit}` }
  })
  const width = (text: string) => {
    'worklet'
    return text ? (layout?.widths[text] ?? 0) : 0
  }
  const baseText = useDerivedValue(() => parts.get().base)
  const valueText = useDerivedValue(() => parts.get().value)
  const unitText = useDerivedValue(() => parts.get().unit)
  const x = useDerivedValue(() => {
    const { base, value, unit } = parts.get()
    return (canvasSize.get().width - width(base) - width(value) - width(unit)) / 2
  })
  const valueX = useDerivedValue(() => x.get() + width(parts.get().base))
  const unitX = useDerivedValue(() => valueX.get() + width(parts.get().value))
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
                  text={valueText}
                  x={valueX}
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
