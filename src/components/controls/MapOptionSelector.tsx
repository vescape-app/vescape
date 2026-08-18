import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated'
import { theme } from '@/constants/theme'

interface MapOption<Key extends string> {
  key: Key
  label: string
  icon: ReactNode
}

interface MapOptionSelectorProps<Key extends string> {
  activeKey: Key
  activeIcon: ReactNode
  activeColor: string
  activeBackground: string
  collapsedAccessibilityLabel: string
  expanded: boolean
  size?: MapOptionSelectorSize
  options: MapOption<Key>[]
  onToggle: () => void
  onSelect: (key: Key) => void
}

export type MapOptionSelectorSize = keyof typeof SELECTOR_METRICS

const SELECTOR_METRICS = {
  sm: {
    height: 38,
    collapsedWidth: 38,
    collapsedButton: 36,
    optionWidth: 40,
    optionHeight: 34,
    activeWidth: 112,
    radius: 19,
    optionRadius: 17,
    iconBoxSize: 26,
    labelFontSize: 12,
    labelMarginLeft: 7,
    paddingHorizontal: 7,
  },
  md: {
    height: 50,
    collapsedWidth: 50,
    collapsedButton: 48,
    optionWidth: 46,
    optionHeight: 46,
    activeWidth: 126,
    radius: 25,
    optionRadius: 23,
    iconBoxSize: 32,
    labelFontSize: 13,
    labelMarginLeft: 8,
    paddingHorizontal: 8,
  },
} as const
const ANIMATION = { duration: 180 } as const
const TRANSPARENT_OPTION_COLOR = theme.alpha(theme.palette.mono.black, 0)

export function MapOptionSelector<Key extends string>({
  activeKey,
  activeIcon,
  activeColor,
  activeBackground,
  collapsedAccessibilityLabel,
  expanded,
  size = 'md',
  options,
  onToggle,
  onSelect,
}: MapOptionSelectorProps<Key>) {
  const metrics = SELECTOR_METRICS[size]
  const optionCount = options.length
  const shellStyle = useAnimatedStyle(
    () => ({
      width: withTiming(getSelectorWidth(metrics, optionCount, expanded), ANIMATION),
    }),
    [expanded, metrics, optionCount],
  )
  const optionsStyle = useAnimatedStyle(
    () => ({
      opacity: withTiming(expanded ? 1 : 0, { duration: expanded ? 120 : 80 }),
    }),
    [expanded],
  )
  const collapsedStyle = useAnimatedStyle(
    () => ({
      opacity: withTiming(expanded ? 0 : 1, { duration: expanded ? 70 : 120 }),
    }),
    [expanded],
  )

  return (
    <Animated.View
      style={[
        styles.container,
        { height: metrics.height, borderRadius: metrics.radius },
        shellStyle,
      ]}
    >
      <Animated.View
        pointerEvents={expanded ? 'auto' : 'none'}
        accessibilityElementsHidden={!expanded}
        importantForAccessibility={expanded ? 'yes' : 'no-hide-descendants'}
        style={[styles.options, optionsStyle]}
      >
        {options.map((option) => (
          <MapOptionButton
            key={option.key}
            label={option.label}
            icon={option.icon}
            selected={activeKey === option.key}
            expanded={expanded}
            activeColor={activeColor}
            activeBackground={activeBackground}
            activeBorder={theme.alpha(activeColor, 0.6)}
            metrics={metrics}
            onPress={() => {
              if (activeKey === option.key) {
                onToggle()
                return
              }
              onSelect(option.key)
            }}
          />
        ))}
      </Animated.View>
      <Animated.View
        pointerEvents={expanded ? 'none' : 'auto'}
        accessibilityElementsHidden={expanded}
        importantForAccessibility={expanded ? 'no-hide-descendants' : 'yes'}
        style={[styles.collapsed, collapsedStyle]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={collapsedAccessibilityLabel}
          accessibilityState={{ expanded }}
          style={[
            styles.collapsedButton,
            {
              width: metrics.collapsedButton,
              height: metrics.collapsedButton,
              borderRadius: metrics.collapsedButton / 2,
            },
          ]}
          onPress={onToggle}
        >
          {activeIcon}
        </Pressable>
      </Animated.View>
    </Animated.View>
  )
}

interface MapOptionButtonProps {
  label: string
  icon: ReactNode
  selected: boolean
  expanded: boolean
  activeColor: string
  activeBackground: string
  activeBorder: string
  metrics: (typeof SELECTOR_METRICS)[MapOptionSelectorSize]
  onPress: () => void
}

function MapOptionButton({
  label,
  icon,
  selected,
  expanded,
  activeColor,
  activeBackground,
  activeBorder,
  metrics,
  onPress,
}: MapOptionButtonProps) {
  const style = useAnimatedStyle(
    () => ({
      width: withTiming(getOptionWidth(metrics, expanded, selected), ANIMATION),
      backgroundColor: withTiming(
        getOptionBackground(activeBackground, expanded, selected),
        ANIMATION,
      ),
      borderColor: withTiming(getOptionBorder(activeBorder, expanded, selected), ANIMATION),
    }),
    [activeBackground, activeBorder, expanded, metrics, selected],
  )
  const labelStyle = useAnimatedStyle(
    () => ({
      opacity: withTiming(expanded && selected ? 1 : 0, ANIMATION),
      maxWidth: withTiming(getLabelMaxWidth(metrics, expanded, selected), ANIMATION),
      marginLeft: withTiming(expanded && selected ? metrics.labelMarginLeft : 0, ANIMATION),
    }),
    [expanded, metrics, selected],
  )

  return (
    <Animated.View
      style={[
        styles.option,
        { height: metrics.optionHeight, borderRadius: metrics.optionRadius },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        style={[styles.optionPressable, { paddingHorizontal: metrics.paddingHorizontal }]}
        onPress={onPress}
      >
        <View style={[styles.iconBox, { width: metrics.iconBoxSize, height: metrics.iconBoxSize }]}>
          {icon}
        </View>
        <Animated.Text
          numberOfLines={1}
          style={[
            styles.selectedLabel,
            { color: activeColor, fontSize: metrics.labelFontSize },
            labelStyle,
          ]}
        >
          {label}
        </Animated.Text>
      </Pressable>
    </Animated.View>
  )
}

function getSelectorWidth(
  metrics: (typeof SELECTOR_METRICS)[MapOptionSelectorSize],
  optionCount: number,
  expanded: boolean,
) {
  'worklet'
  if (!expanded) return metrics.collapsedWidth
  return metrics.activeWidth + metrics.optionWidth * (optionCount - 1) + 4
}

function getOptionWidth(
  metrics: (typeof SELECTOR_METRICS)[MapOptionSelectorSize],
  expanded: boolean,
  selected: boolean,
) {
  'worklet'
  return expanded && selected ? metrics.activeWidth : metrics.optionWidth
}

function getLabelMaxWidth(
  metrics: (typeof SELECTOR_METRICS)[MapOptionSelectorSize],
  expanded: boolean,
  selected: boolean,
) {
  'worklet'
  if (!expanded || !selected) return 0
  return (
    metrics.activeWidth -
    metrics.iconBoxSize -
    metrics.labelMarginLeft -
    metrics.paddingHorizontal * 2
  )
}

function getOptionBackground(activeBackground: string, expanded: boolean, selected: boolean) {
  'worklet'
  return expanded && selected ? activeBackground : TRANSPARENT_OPTION_COLOR
}

function getOptionBorder(activeBorder: string, expanded: boolean, selected: boolean) {
  'worklet'
  return expanded && selected ? activeBorder : TRANSPARENT_OPTION_COLOR
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
  },
  options: {
    position: 'absolute',
    top: 2,
    right: 2,
    bottom: 2,
    left: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  collapsed: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsedButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
  },
  option: {
    overflow: 'hidden',
    borderWidth: 1,
  },
  optionPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  iconBox: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  selectedLabel: {
    overflow: 'hidden',
    fontFamily: theme.font('600'),
  },
})
