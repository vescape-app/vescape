import type { Icon } from 'phosphor-react-native'
import Svg, { Path } from 'react-native-svg'

import { theme } from '@/constants/theme'

const STROKE_WIDTH = 7

function iconSize(size: string | number | undefined) {
  return typeof size === 'number' ? size : Number(size) || 24
}

export const BonkMapPointIcon: Icon = ({ color = theme.neutral.textSecondary, size, style }) => {
  const dim = iconSize(size)
  return (
    <Svg width={dim} height={dim} viewBox="0 0 102 100" fill="none" style={style}>
      <Path
        d="M6 46.6671C29.2201 48.3525 47.0317 44.9124 52.5155 6M39.131 11.9365L52.5155 6L61 17.9516"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M42.8958 79.6807C37.4886 81.3018 34.2443 76.4386 31 72.1158C31 68.3333 35.8665 64.0107 37.4886 60.7686C39.1108 57.5265 49.9251 54.8247 53.7101 51.5826C57.4951 48.3405 67.7687 59.6878 73.7166 59.6878C79.6645 59.6878 79.1238 66.172 80.7459 72.1158C82.3681 78.0597 75.8795 79.6807 71.013 79.6807C66.1466 79.6807 48.3029 78.0597 42.8958 79.6807Z"
        fill={theme.neutral.surfaceDeep}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export const DropMapPointIcon: Icon = ({ color = theme.neutral.textSecondary, size, style }) => {
  const dim = iconSize(size)
  return (
    <Svg width={dim} height={dim} viewBox="0 0 102 100" fill="none" style={style}>
      <Path
        d="M6 43.6733H51.3759V87H98M15.8211 12.1797C52.2041 10.736 81.3105 17.234 85.7957 59.5472M71.6084 52.6177L85.7957 59.5472L95.3609 46.9354"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export const SlideMapPointIcon: Icon = ({ color = theme.neutral.textSecondary, size, style }) => {
  const dim = iconSize(size)
  return (
    <Svg width={dim} height={dim} viewBox="0 0 102 100" fill="none" style={style}>
      <Path
        d="M88.8168 37.1501L88.8164 10.4482L16.1812 62.4482L16.1812 84.8197M79.2133 37.1501L88.8168 37.1501L98.0417 37.1482M16.1812 84.8197L27.915 84.8197M16.1812 84.8197L4.17528 84.8197"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}
