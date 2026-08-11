import { useFont } from '@shopify/react-native-skia'
import type { FontWeight, MonoWeight } from '@/constants/theme'

/** Metro needs static `require` calls, so every Raleway weight is mapped explicitly. */
const fontSources: Record<FontWeight, number> = {
  '300': require('../../assets/fonts/Raleway-300.ttf'),
  '400': require('../../assets/fonts/Raleway-400.ttf'),
  '500': require('../../assets/fonts/Raleway-500.ttf'),
  '600': require('../../assets/fonts/Raleway-600.ttf'),
  '700': require('../../assets/fonts/Raleway-700.ttf'),
  '800': require('../../assets/fonts/Raleway-800.ttf'),
  '900': require('../../assets/fonts/Raleway-900.ttf'),
}

const monoSources: Record<MonoWeight, number> = {
  '500': require('../../assets/fonts/JetBrainsMono-500.ttf'),
  '600': require('../../assets/fonts/JetBrainsMono-600.ttf'),
  '700': require('../../assets/fonts/JetBrainsMono-700.ttf'),
  '800': require('../../assets/fonts/JetBrainsMono-800.ttf'),
}

/** App font (Raleway) as a Skia `SkFont` for canvas text. Returns null until loaded. */
export const useSkiaFont = (weight: FontWeight, size: number) => useFont(fontSources[weight], size)

/** Readout font (JetBrains Mono) as a Skia `SkFont`. Returns null until loaded. */
export const useSkiaMonoFont = (weight: MonoWeight, size: number) =>
  useFont(monoSources[weight], size)
