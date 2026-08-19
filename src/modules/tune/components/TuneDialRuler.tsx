import {
  Canvas,
  DashPathEffect,
  Group,
  Line,
  LinearGradient,
  Path,
  Rect,
  Skia,
  Text as SkiaText,
  vec,
} from '@shopify/react-native-skia'
import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import {
  useResolvedAccentColors,
  useResolvedColor,
  useResolvedNeutralColors,
} from '@/hooks/useTheme'
import { useSkiaFont } from '@/hooks/useSkiaFont'
import { formatTuneValue } from '@/modules/tune/lib/fields'
import {
  CURRENT_VALUE_TOP,
  GLOW_WIDTH,
  LABEL_BASELINE_Y,
  LABEL_FONT_SIZE,
  MAJOR_TICK_TOP,
  RULER_LABEL_BAND_TOP,
  TOP_VALUE_BAND_HEIGHT,
} from '@/modules/tune/components/tuneDialLayout'
import type { computeTuneDialLayout } from '@/modules/tune/components/tuneDialPhysics'
import { textAdvanceWidth } from '../../../helpers/skiaText'

/** The scrolling ruler: tick marks, value labels, the previous-value mark and the edge glow. */
export function TuneDialRuler({
  canvasWidth,
  translateX,
  min,
  step,
  decimals,
  color,
  indicatorGlow,
  previousValue,
  valueToOffset,
  layout,
}: {
  canvasWidth: number
  translateX: SharedValue<number>
  min: number
  step: number
  decimals: number
  color: string
  indicatorGlow?: 'left' | 'right'
  previousValue?: number
  valueToOffset: (value: number) => number
  layout: ReturnType<typeof computeTuneDialLayout>
}) {
  const neutral = useResolvedNeutralColors()
  const accents = useResolvedAccentColors()
  const resolvedColor = useResolvedColor(color)
  const {
    totalSteps,
    stepPx,
    majorEvery,
    minorEvery,
    renderMinor,
    labelEveryStep,
    renderMidpointTicks,
  } = layout
  const centerX = canvasWidth / 2
  const stripTransform = useDerivedValue(() => [{ translateX: centerX + translateX.value }])
  const labelFont = useSkiaFont('700', LABEL_FONT_SIZE)
  const prevLabelFont = useSkiaFont('800', LABEL_FONT_SIZE)
  const prevMarkOffset = previousValue != null ? valueToOffset(previousValue) : null
  const previousValueLabel = previousValue != null ? formatTuneValue(previousValue) : null

  const { majorTicksPath, minorTicksPath, labels } = useMemo(() => {
    const majorPath = Skia.Path.Make()
    const minorPath = Skia.Path.Make()
    const labelList: { key: number; text: string; x: number }[] = []

    for (let i = 0; i <= totalSteps; i++) {
      const val = Number((min + i * step).toFixed(decimals))
      const x = i * stepPx
      const isMajor = labelEveryStep || i % majorEvery === 0
      const isMinor = !isMajor && renderMinor && i % minorEvery === 0

      if (isMajor) {
        majorPath.moveTo(x, MAJOR_TICK_TOP)
        majorPath.lineTo(x, RULER_LABEL_BAND_TOP)
        const text = formatTuneValue(val)
        const textX = labelFont ? x - textAdvanceWidth(labelFont, text) / 2 : x
        labelList.push({ key: i, text, x: textX })
      } else if (isMinor) {
        minorPath.moveTo(x, TOP_VALUE_BAND_HEIGHT + 9)
        minorPath.lineTo(x, TOP_VALUE_BAND_HEIGHT + 9 + 36)
      }

      if (renderMidpointTicks && i < totalSteps) {
        const midX = x + stepPx / 2
        minorPath.moveTo(midX, TOP_VALUE_BAND_HEIGHT + 11)
        minorPath.lineTo(midX, TOP_VALUE_BAND_HEIGHT + 11 + 26)
      }
    }
    return { majorTicksPath: majorPath, minorTicksPath: minorPath, labels: labelList }
  }, [
    totalSteps,
    min,
    step,
    decimals,
    stepPx,
    majorEvery,
    minorEvery,
    renderMinor,
    labelEveryStep,
    renderMidpointTicks,
    labelFont,
  ])

  const prevLabelX =
    prevMarkOffset != null && previousValueLabel != null && prevLabelFont
      ? prevMarkOffset - textAdvanceWidth(prevLabelFont, previousValueLabel) / 2
      : null

  return (
    <Canvas style={styles.canvas}>
      <Group transform={stripTransform}>
        <Path path={minorTicksPath} style="stroke" color={neutral.border} strokeWidth={1} />
        <Path path={majorTicksPath} style="stroke" color={neutral.textMuted} strokeWidth={1} />
        {labelFont &&
          labels.map((label) => (
            <SkiaText
              key={label.key}
              x={label.x}
              y={LABEL_BASELINE_Y}
              text={label.text}
              font={labelFont}
              color={neutral.textMuted}
            />
          ))}
        {prevMarkOffset != null && (
          <>
            <Rect
              x={prevMarkOffset - 1.5}
              y={TOP_VALUE_BAND_HEIGHT}
              width={3}
              height={RULER_LABEL_BAND_TOP - TOP_VALUE_BAND_HEIGHT}
              color={neutral.surface}
            />
            <Line
              p1={vec(prevMarkOffset, TOP_VALUE_BAND_HEIGHT)}
              p2={vec(prevMarkOffset, RULER_LABEL_BAND_TOP)}
              color={accents.yellow.color}
              strokeWidth={1}
            >
              <DashPathEffect intervals={[3, 3]} />
            </Line>
            {previousValueLabel != null && prevLabelX != null && prevLabelFont && (
              <SkiaText
                x={prevLabelX}
                y={LABEL_BASELINE_Y}
                text={previousValueLabel}
                font={prevLabelFont}
                color={accents.yellow.color}
              />
            )}
          </>
        )}
      </Group>
      {indicatorGlow && (
        <Rect
          x={indicatorGlow === 'left' ? centerX - GLOW_WIDTH : centerX}
          y={CURRENT_VALUE_TOP}
          width={GLOW_WIDTH}
          height={RULER_LABEL_BAND_TOP - CURRENT_VALUE_TOP}
        >
          <LinearGradient
            start={vec(indicatorGlow === 'left' ? centerX - GLOW_WIDTH : centerX, 0)}
            end={vec(indicatorGlow === 'left' ? centerX : centerX + GLOW_WIDTH, 0)}
            colors={
              indicatorGlow === 'left'
                ? [`${resolvedColor}00`, `${resolvedColor}12`, `${resolvedColor}1A`]
                : [`${resolvedColor}1A`, `${resolvedColor}12`, `${resolvedColor}00`]
            }
          />
        </Rect>
      )}
    </Canvas>
  )
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
  },
})
