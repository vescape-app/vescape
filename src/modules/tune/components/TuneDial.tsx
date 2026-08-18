import { use, useCallback, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { useDerivedValue } from 'react-native-reanimated'
import { Canvas, Text as SkiaText } from '@shopify/react-native-skia'

import { Text } from '@/components/base/Text'
import { NativeScrollGestureContext } from '@/components/gestures/NativeScrollGestureContext'
import { theme } from '@/constants/theme'
import { useSkiaFont } from '@/hooks/useSkiaFont'
import { computeTuneDialLayout } from '@/modules/tune/components/tuneDialPhysics'
import {
  BADGE_BASELINE,
  BADGE_FONT_SIZE,
  BADGE_WIDTH,
  CURRENT_VALUE_TOP,
  DIAL_HEIGHT,
  RULER_LABEL_BAND_TOP,
  TOP_VALUE_BAND_HEIGHT,
  formatDisplayValue,
} from '@/modules/tune/components/tuneDialLayout'
import { TuneDialRuler } from '@/modules/tune/components/TuneDialRuler'
import { useTuneDialGesture } from '@/modules/tune/components/useTuneDialGesture'
import { textAdvanceWidth } from '../../../helpers/skiaText'

interface TuneDialProps {
  value: number
  previousValue?: number
  min: number
  max: number
  step: number
  unit?: string | null
  indicatorGlow?: 'left' | 'right'
  valueChangeMode?: 'live' | 'commit'
  color?: string
  onValueChange: (value: number) => void
}

/** A horizontal ruler the rider drags to pick a value, with haptic steps and end stops. */
export function TuneDial({
  value,
  previousValue,
  min,
  max,
  step,
  unit,
  indicatorGlow,
  valueChangeMode = 'commit',
  color = theme.telemetry.speed,
  onValueChange,
}: TuneDialProps) {
  'use no memo'
  const nativeScrollGesture = use(NativeScrollGestureContext)
  const range = max - min
  const layout = useMemo(() => computeTuneDialLayout(min, max, step), [min, max, step])
  const decimals = step < 1 ? Math.ceil(Math.abs(Math.log10(step))) : 0
  const [canvasWidth, setCanvasWidth] = useState(0)

  const valueToOffset = useCallback(
    (v: number) => ((v - min) / range) * layout.totalWidth,
    [layout.totalWidth, min, range],
  )

  const { translateX, displayValue, panGesture } = useTuneDialGesture({
    value,
    min,
    max,
    step,
    decimals,
    commitEveryChange: valueChangeMode === 'live',
    totalSteps: layout.totalSteps,
    totalWidth: layout.totalWidth,
    stepPx: layout.stepPx,
    valueToOffset,
    nativeScrollGesture,
    onValueChange,
  })

  const badgeFont = useSkiaFont('800', BADGE_FONT_SIZE)
  const badgeText = useDerivedValue(() => formatDisplayValue(displayValue.value, decimals))
  const badgeX = useDerivedValue(() =>
    badgeFont ? BADGE_WIDTH - textAdvanceWidth(badgeFont, badgeText.value) : 0,
  )

  const dial = (
    <View style={styles.rootView}>
      <View style={styles.container} onLayout={(e) => setCanvasWidth(e.nativeEvent.layout.width)}>
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            {canvasWidth > 0 && (
              <TuneDialRuler
                canvasWidth={canvasWidth}
                translateX={translateX}
                min={min}
                step={step}
                decimals={decimals}
                color={color}
                indicatorGlow={indicatorGlow}
                previousValue={previousValue}
                valueToOffset={valueToOffset}
                layout={layout}
              />
            )}
          </Animated.View>
        </GestureDetector>
        <View
          style={[styles.indicatorTop, { backgroundColor: color, shadowColor: color }]}
          pointerEvents="none"
        />
        <View style={styles.valueBadgeAnchor} pointerEvents="none">
          <Canvas style={styles.valueBadgeCanvas}>
            {badgeFont && (
              <SkiaText
                x={badgeX}
                y={BADGE_BASELINE}
                text={badgeText}
                font={badgeFont}
                color={color}
              />
            )}
          </Canvas>
          {unit ? <Text style={styles.valueBadgeUnit}>{unit}</Text> : null}
        </View>
      </View>
    </View>
  )

  return nativeScrollGesture ? dial : <GestureHandlerRootView>{dial}</GestureHandlerRootView>
}

const MARKER_LINE_WIDTH = 2.5

const styles = StyleSheet.create({
  rootView: {
    overflow: 'hidden',
    borderRadius: 12,
  },
  container: {
    height: DIAL_HEIGHT,
    overflow: 'hidden',
  },
  gestureArea: {
    flex: 1,
  },
  canvas: {
    width: '100%',
    height: DIAL_HEIGHT,
  },
  indicatorTop: {
    position: 'absolute',
    top: CURRENT_VALUE_TOP,
    left: '50%',
    width: MARKER_LINE_WIDTH,
    height: RULER_LABEL_BAND_TOP - CURRENT_VALUE_TOP,
    marginLeft: -MARKER_LINE_WIDTH / 2,
    borderRadius: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 4,
  },
  valueBadgeAnchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: CURRENT_VALUE_TOP,
    height: TOP_VALUE_BAND_HEIGHT - CURRENT_VALUE_TOP,
  },
  valueBadgeCanvas: {
    position: 'absolute',
    right: '50%',
    marginRight: 7,
    width: BADGE_WIDTH,
    height: 22,
  },
  valueBadgeUnit: {
    position: 'absolute',
    left: '50%',
    marginLeft: 7,
    bottom: 3,
    color: theme.palette.slate.textMuted,
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 10,
    textAlign: 'left',
  },
})
