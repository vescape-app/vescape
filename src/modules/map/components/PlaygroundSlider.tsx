import { useEffect, useRef, useState } from 'react'
import { PanResponder, StyleSheet, View, type GestureResponderHandlers } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

interface PlaygroundSliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  color?: string
  format?: (value: number) => string
  onChange: (value: number) => void
}

const THUMB = 14

/**
 * Minimal drag/tap slider for the camera playground. The app has no generic
 * slider primitive (Tune uses its own dial), and this one stays dev-only.
 */
export function PlaygroundSlider({
  label,
  value,
  min,
  max,
  step = 0.1,
  color = theme.palette.sky.color,
  format,
  onChange,
}: PlaygroundSliderProps) {
  const [width, setWidth] = useState(0)
  const widthRef = useRef(0)
  const trackLeftRef = useRef(0)
  const latest = useRef({ min, max, step, onChange })
  useEffect(() => {
    latest.current = { min, max, step, onChange }
  }, [min, max, step, onChange])

  // Built in an effect, not render: the handlers close over refs, and the track
  // has no width to map a touch onto until after the first layout anyway.
  const [handlers, setHandlers] = useState<GestureResponderHandlers | null>(null)
  useEffect(() => {
    const emit = (x: number) => {
      const track = widthRef.current
      if (track <= 0) return
      const { min: lo, max: hi, step: s, onChange: cb } = latest.current
      const ratio = Math.min(1, Math.max(0, x / track))
      const raw = lo + ratio * (hi - lo)
      cb(Math.min(hi, Math.max(lo, Math.round(raw / s) * s)))
    }
    setHandlers(
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        // Anchor on the track's page position at grant: locationX on later
        // moves is relative to whatever view sits under the finger, so a drag
        // over the fill/thumb children would otherwise collapse toward zero.
        onPanResponderGrant: (event) => {
          trackLeftRef.current = event.nativeEvent.pageX - event.nativeEvent.locationX
          emit(event.nativeEvent.locationX)
        },
        onPanResponderMove: (event) => emit(event.nativeEvent.pageX - trackLeftRef.current),
      }).panHandlers,
    )
  }, [])

  const ratio = max === min ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min)))
  const text = format ? format(value) : value.toFixed(2)

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, { color }]}>{text}</Text>
      </View>
      <View
        style={styles.track}
        onLayout={(event) => {
          const w = event.nativeEvent.layout.width
          widthRef.current = w
          setWidth(w)
        }}
        {...handlers}
      >
        <View
          pointerEvents="none"
          style={[styles.fill, { width: ratio * width, backgroundColor: color }]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            { left: Math.max(0, ratio * width - THUMB / 2), borderColor: color },
          ]}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: {
    color: theme.palette.slate.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  value: { fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  track: {
    height: 22,
    justifyContent: 'center',
    backgroundColor: theme.palette.slate.surfaceDeep,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    overflow: 'hidden',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, opacity: 0.35 },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 2,
    backgroundColor: theme.palette.slate.surface,
  },
})
