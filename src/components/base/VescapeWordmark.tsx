import type { StyleProp, ViewStyle } from 'react-native'
import { LocalSvg } from 'react-native-svg/css'

import { useResolvedNeutralColors } from '@/hooks/useTheme'

const WORDMARK = require('@/../assets/logo/Vescape-text.svg')
const ASPECT_RATIO = 1221 / 375

interface VescapeWordmarkProps {
  width?: number
  style?: StyleProp<ViewStyle>
}

export function VescapeWordmark({ width = 220, style }: VescapeWordmarkProps) {
  const neutral = useResolvedNeutralColors()

  return (
    <LocalSvg
      asset={WORDMARK}
      width={width}
      height={width / ASPECT_RATIO}
      color={neutral.textPrimary}
      style={style}
    />
  )
}
