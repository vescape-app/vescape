import { Image } from 'expo-image'
import type { StyleProp, ImageStyle } from 'react-native'

// Source PNG is 1200x369; keep that ratio so callers only set a width.
const WORDMARK = require('@/../assets/images/splashIcon.png')
const ASPECT_RATIO = 1200 / 369

interface VescapeWordmarkProps {
  width?: number
  style?: StyleProp<ImageStyle>
}

export function VescapeWordmark({ width = 220, style }: VescapeWordmarkProps) {
  return (
    <Image
      source={WORDMARK}
      style={[{ width, height: width / ASPECT_RATIO }, style]}
      contentFit="contain"
    />
  )
}
