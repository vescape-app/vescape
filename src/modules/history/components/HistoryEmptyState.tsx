import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { Canvas, Group, RadialGradient, Rect, vec } from '@shopify/react-native-skia'
import { ClockCounterClockwiseIcon, StarIcon } from 'phosphor-react-native'

import { Placeholder } from '@/components/base/Placeholder'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

const DIM_POSITIONS = [0, 0.4, 0.7, 1]

/** Soft center dim so the placeholder stays readable over map labels — no box, blends into the edge vignette. */
function CenterDim() {
  const neutral = useResolvedNeutralColors()
  const { width, height } = useWindowDimensions()
  const radius = width * 0.75
  const scaleY = (height * 0.4) / radius

  return (
    <Canvas style={StyleSheet.absoluteFill}>
      <Group origin={vec(width / 2, height / 2)} transform={[{ scaleY }]}>
        <Rect x={0} y={height / 2 - radius} width={width} height={radius * 2}>
          <RadialGradient
            c={vec(width / 2, height / 2)}
            r={radius}
            colors={([0.8, 0.6, 0.3, 0] as const).map((level) =>
              theme.alpha(neutral.surfaceDeep, level),
            )}
            positions={DIM_POSITIONS}
          />
        </Rect>
      </Group>
    </Canvas>
  )
}

interface HistoryEmptyStateProps {
  favoriteMode?: boolean
}

export function HistoryEmptyState({ favoriteMode = false }: HistoryEmptyStateProps) {
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <CenterDim />
      <Placeholder
        icon={favoriteMode ? StarIcon : ClockCounterClockwiseIcon}
        title={favoriteMode ? 'No favorites yet' : 'No rides yet'}
        description={
          favoriteMode
            ? 'Open a ride in History, tap the star, adjust the range, then save'
            : 'Record your first ride and its stats will show up here'
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFill,
    zIndex: 12,
  },
})
