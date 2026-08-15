import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { CaretDownIcon, CaretUpIcon, type Icon } from 'phosphor-react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { useEdgeDrawerScrollToOpenEdge } from '@/components/overlays/AnchoredSheet'
import { widgetSurface } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'

const COLLAPSE_DURATION = 220
const COLLAPSE_EASING = Easing.out(Easing.cubic)

interface CollapsibleWidgetProps {
  icon: Icon
  title: string
  description?: string
  accent?: string
  collapsible?: boolean
  defaultExpanded?: boolean
  expandedHeight?: number
  surface?: boolean
  children: ReactNode
}

export function CollapsibleWidget({
  icon: IconComponent,
  title,
  description,
  accent = theme.control.textMuted,
  collapsible = true,
  defaultExpanded = false,
  expandedHeight = 420,
  surface = true,
  children,
}: CollapsibleWidgetProps) {
  const [expanded, setExpanded] = useState(defaultExpanded || !collapsible)
  const scrollToOpenEdge = useEdgeDrawerScrollToOpenEdge()
  const progress = useSharedValue(defaultExpanded || !collapsible ? 1 : 0)

  useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, {
      duration: COLLAPSE_DURATION,
      easing: COLLAPSE_EASING,
    })
  }, [expanded, progress])

  const collapsibleBodyStyle = useAnimatedStyle(() => ({
    height: expandedHeight * progress.value,
    opacity: progress.value,
  }))
  const collapsibleContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * -8 }],
  }))

  const toggleExpanded = () => {
    if (!collapsible) return
    const next = !expanded
    setExpanded(next)
    if (!next) return
    requestAnimationFrame(() => scrollToOpenEdge?.())
    setTimeout(() => scrollToOpenEdge?.(), COLLAPSE_DURATION)
  }

  const body = (
    <Animated.View style={[styles.body, collapsible && collapsibleContentStyle]}>
      {children}
    </Animated.View>
  )

  return (
    <View style={[surface && styles.widget]}>
      <Pressable
        disabled={!collapsible}
        onPress={toggleExpanded}
        style={({ pressed }) => [
          styles.header,
          collapsible && styles.headerPressable,
          pressed && styles.headerPressed,
        ]}
        accessibilityRole={collapsible ? 'button' : undefined}
        accessibilityLabel={title}
      >
        <View style={styles.titleRow}>
          <IconComponent size={22} color={accent} weight="duotone" />
          <View style={styles.textColumn}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {description ? (
              <Text style={styles.description} numberOfLines={2}>
                {description}
              </Text>
            ) : null}
          </View>
        </View>
        {collapsible ? (
          expanded ? (
            <CaretUpIcon size={16} color={theme.control.textMuted} weight="bold" />
          ) : (
            <CaretDownIcon size={16} color={theme.control.textMuted} weight="bold" />
          )
        ) : null}
      </Pressable>
      {collapsible ? (
        <Animated.View style={[styles.collapsibleBody, collapsibleBodyStyle]}>{body}</Animated.View>
      ) : (
        body
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  widget: {
    ...widgetSurface,
    padding: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  headerPressable: {
    minHeight: 46,
  },
  headerPressed: {
    opacity: 0.7,
  },
  titleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  title: {
    color: theme.control.text,
    fontSize: 15,
    fontWeight: '800',
  },
  description: {
    color: theme.control.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  collapsibleBody: {
    overflow: 'hidden',
  },
  body: {
    gap: 8,
    paddingTop: 8,
  },
})
