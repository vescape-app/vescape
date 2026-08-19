import { useMemo } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import {
  useDerivedValue,
  useSharedValue,
  type DerivedValue,
  type SharedValue,
} from 'react-native-reanimated'
import { Canvas, Text as SkiaText } from '@shopify/react-native-skia'

import { theme, type MonoWeight } from '@/constants/theme'
import { useSkiaMonoFont } from '@/hooks/useSkiaFont'
import { textAdvanceWidth } from '../../helpers/skiaText'
import { useResolvedColor } from '@/hooks/useTheme'

export type MonoValueAlign = 'left' | 'center' | 'right'

/** Line box around a glyph size, matching the ~1.3 leading RN applies by default. */
export const TEXT_LINE_RATIO = 1.3

export interface MonoTextProps {
  /** Live text driven off the UI thread. Updates never re-render React. */
  text: DerivedValue<string>
  size: number
  weight?: MonoWeight
  /** Static color, or a shared value for colors that ramp with the value. */
  color?: string | SharedValue<string>
  align?: MonoValueAlign
  /** Left edge of the layout box, in canvas coordinates. */
  x?: number
  /** Top edge of the layout box, in canvas coordinates. */
  y?: number
  /** Box the text aligns inside. A shared value when the box is measured. */
  width: number | DerivedValue<number>
  /** Box the glyphs are vertically centered in. */
  height: number
}

/**
 * Live readout as a Skia node, for drawing into a canvas that already exists.
 *
 * Readouts used to be non-editable `TextInput`s written through `animatedProps`
 * (the classic Reanimated trick). That routes every tick through the shadow
 * tree: on Android the chained `AndroidTextInputState` commits overflowed the
 * GC thread stack, and on iOS a text commit racing the UI-thread prop write
 * could blank the value mid-ride. Skia draws bypass the shadow tree entirely,
 * so a tick is a repaint and nothing else.
 *
 * Prefer this over `MonoValue` whenever the surrounding component already owns
 * a canvas: every canvas is a separate native surface, and a screen full of
 * one-readout canvases costs far more than one canvas full of readouts.
 */
export function MonoText({
  text,
  size,
  weight = '700',
  color = theme.palette.slate.textPrimary,
  align = 'left',
  x = 0,
  y = 0,
  width,
  height,
}: MonoTextProps) {
  const font = useSkiaMonoFont(weight, size)
  const rendererColor = useResolvedColor(color as string)

  // Vertically center the glyph box: ascent is negative, descent positive.
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

export interface MonoValueProps extends Omit<MonoTextProps, 'x' | 'y' | 'width' | 'height'> {
  /** Fixed canvas width. Omit to stretch and measure the box on layout. */
  width?: number
  /** Canvas height. Defaults to a line box derived from `size`. */
  height?: number
  style?: StyleProp<ViewStyle>
}

/**
 * Standalone live readout: a `MonoText` with a canvas of its own.
 *
 * Use it for a readout that sits on plain views. If the parent already draws on
 * Skia, place a `MonoText` in that canvas instead of mounting another surface.
 */
export function MonoValue({ size, width, height, style, ...textProps }: MonoValueProps) {
  const lineHeight = height ?? Math.ceil(size * TEXT_LINE_RATIO)
  // `onLayout` is unsupported on Fabric canvases; `onSize` reports the measured
  // box straight into a shared value, so alignment stays off the JS thread.
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
