import type { SkFont } from '@shopify/react-native-skia'

export function textAdvanceWidth(font: SkFont, text: string): number {
  'worklet'
  const widths = font.getGlyphWidths(font.getGlyphIDs(text))
  let total = 0
  for (const width of widths) total += width
  return total
}
