import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import { Text } from '@/components/base/Text'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { GROUPS } from './tuneRingControls'

function SectionTab({
  index,
  label,
  active,
  color,
  position,
  width,
  onPress,
}: {
  index: number
  label: string
  active: boolean
  color: string
  position?: SharedValue<number>
  width: number
  onPress: () => void
}) {
  'use no memo'
  const neutral = useResolvedNeutralColors()
  const underline = useAnimatedStyle(() => ({
    opacity: position ? Math.max(0, 1 - Math.abs(position.value / width - index)) : active ? 1 : 0,
  }))
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={styles.tab}
      onPress={onPress}
    >
      <Text
        style={{
          color,
          fontSize: 11,
          fontWeight: '700',
          textAlign: 'center',
        }}
      >
        {index + 1} · {label}
      </Text>
      <View style={[styles.track, { backgroundColor: neutral.border }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: color }, underline]} />
      </View>
    </Pressable>
  )
}
export function TuneRingSectionTabs({
  page,
  onPage,
  position,
  pageWidth = 1,
  style,
}: {
  page: number
  onPage: (page: number) => void
  position?: SharedValue<number>
  pageWidth?: number
  style?: StyleProp<ViewStyle>
}) {
  const accents = useResolvedAccentColors()
  const colors = [accents.blue.color, accents.red.color, accents.violet.color]
  return (
    <View style={[styles.row, style]}>
      {GROUPS.map((group, index) => (
        <SectionTab
          key={group.name}
          index={index}
          label={group.name}
          active={page === index}
          color={colors[index]}
          position={position}
          width={pageWidth}
          onPress={() => onPage(index)}
        />
      ))}
    </View>
  )
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  tab: { flex: 1, gap: 8 },
  track: { height: 2, borderRadius: 1, overflow: 'hidden' },
})
