import { useMemo } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import {
  isSharedValue,
  useDerivedValue,
  useSharedValue,
  type DerivedValue,
} from 'react-native-reanimated'
import { Canvas, Text as SkiaText } from '@shopify/react-native-skia'

import { theme, type MonoWeight, type ThemeColor } from '@/constants/theme'
import { useSkiaMonoFont } from '@/hooks/useSkiaFont'
import { textAdvanceWidth } from '../../helpers/skiaText'
import { useResolvedColor } from '@/hooks/useTheme'

export type MonoValueAlign = 'left' | 'center' | 'right'

export const TEXT_LINE_RATIO = 1.3

export interface MonoTextProps {
  text: DerivedValue<string>
  size: number
  weight?: MonoWeight
  color?: ThemeColor | DerivedValue<string>
  align?: MonoValueAlign
  x?: number
  y?: number
  width: number | DerivedValue<number>
  height: number
}

export function MonoText({
  text,
  size,
  weight = '700',
  color = theme.neutral.textPrimary,
  align = 'left',
  x = 0,
  y = 0,
  width,
  height,
}: MonoTextProps) {
  const font = useSkiaMonoFont(weight, size)
  const staticColor = useResolvedColor(
    isSharedValue<string>(color) ? theme.neutral.textPrimary : (color as ThemeColor),
  )
  const rendererColor = isSharedValue<string>(color) ? color : staticColor

  const baseline = useMemo(() => {
    if (!font) return 0
    const { ascent, descent } = font.getMetrics()
    return y + height / 2 - (ascent + descent) / 2
  }, [font, height, y])

  const textX = useDerivedValue(() => {
    if (!font || align === 'left') return x
    const box = typeof width === 'number' ? width : width.value
    const free = box - textAdvanceWidth(font, text.value)
    return x + (align === 'center' ? free / 2 : free)
  })

  if (!font) return null
  return <SkiaText x={textX} y={baseline} text={text} font={font} color={rendererColor} />
}

export interface MonoReadoutProps {
  text: DerivedValue<string>
  unit: DerivedValue<string>
  size: number
  unitSize: number
  weight?: MonoWeight
  color?: ThemeColor | DerivedValue<string>
  align?: 'left' | 'right'
  x: number
  y: number
  width: number
}

const UNIT_GAP = 1

export function MonoReadout({
  text,
  unit,
  size,
  unitSize,
  weight = '800',
  color = theme.neutral.textPrimary,
  align = 'right',
  x,
  y,
  width,
}: MonoReadoutProps) {
  const valueFont = useSkiaMonoFont(weight, size)
  const unitFont = useSkiaMonoFont('500', unitSize)
  const staticColor = useResolvedColor(
    isSharedValue<string>(color) ? theme.neutral.textPrimary : (color as ThemeColor),
  )
  const unitColor = isSharedValue<string>(color) ? color : staticColor
  const baseline = useMemo(() => {
    if (!valueFont) return 0
    const { ascent, descent } = valueFont.getMetrics()
    return y + size / 2 - (ascent + descent) / 2
  }, [size, valueFont, y])
  const unitX = useDerivedValue(() =>
    align === 'right' || !valueFont
      ? x + width + UNIT_GAP
      : x + textAdvanceWidth(valueFont, text.value) + UNIT_GAP,
  )

  return (
    <>
      <MonoText
        text={text}
        size={size}
        weight={weight}
        color={color}
        align={align}
        x={x}
        y={y}
        width={width}
        height={size}
      />
      {unitFont ? (
        <SkiaText x={unitX} y={baseline} text={unit} font={unitFont} color={unitColor} />
      ) : null}
    </>
  )
}

export interface MonoValueProps extends Omit<MonoTextProps, 'x' | 'y' | 'width' | 'height'> {
  width?: number
  height?: number
  style?: StyleProp<ViewStyle>
}

export function MonoValue({ size, width, height, style, ...textProps }: MonoValueProps) {
  const lineHeight = height ?? Math.ceil(size * TEXT_LINE_RATIO)
  const canvasSize = useSharedValue({ width: width ?? 0, height: lineHeight })
  const measuredWidth = useDerivedValue(() => canvasSize.value.width)

  return (
    <Canvas
      style={[{ height: lineHeight }, width == null ? null : { width }, style]}
      onSize={canvasSize}
      pointerEvents="none"
    >
      <MonoText {...textProps} size={size} width={width ?? measuredWidth} height={lineHeight} />
    </Canvas>
  )
}
