import type { SkFont } from '@shopify/react-native-skia'

/**
 * Advance width of `text` in `font`, i.e. how far the pen moves — what layout and centering
 * need. Replaces the deprecated `SkFont.getTextWidth`; `measureText` returns ink bounds, which
 * are tighter and jitter per glyph.
 */
export function textAdvanceWidth(font: SkFont, text: string): number {
  'worklet'
  const widths = font.getGlyphWidths(font.getGlyphIDs(text))
  let total = 0
  for (const width of widths) total += width
  return total
}
