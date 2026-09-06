import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { PlusIcon } from 'phosphor-react-native'
import type { Icon } from 'phosphor-react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import { Text } from '@/components/base/Text'
import { Dropdown, useTriggerRef } from '@/components/forms/Dropdown'
import { theme } from '@/constants/theme'
import { useResolvedColor, useResolvedControlColors, useThemeStore } from '@/hooks/useTheme'
import type { PillSelectorItemProps } from '@/components/controls/PillSelectorItem'
import {
  PillSelectorContext,
  TRANSPARENT,
  TUNE_ANIMATION,
  TUNE_DEFAULT_ACTIVE_WIDTH,
  TUNE_OPTION_WIDTH,
  styles,
  usePillSelectorCtx,
} from '@/components/controls/pillSelectorShared'

export { PillSelectorItem } from '@/components/controls/PillSelectorItem'

interface MenuState {
  triggerRef: React.RefObject<View | null>
  content: ReactNode
}

interface PillSelectorProps {
  activeId: string
  children: ReactNode
  centered?: boolean
  contained?: boolean
  fitContent?: boolean
  showFullLabel?: boolean
  variant?: 'control' | 'lightTabs'
  style?: StyleProp<ViewStyle>
  contentContainerStyle?: StyleProp<ViewStyle>
}

function getFitContentWidth(
  children: ReactNode,
  activeId: string,
  gap: number,
  contained: boolean,
  showFullLabel: boolean,
) {
  const items = Children.toArray(children).filter(Boolean)
  const contentWidth = items.reduce<number>((width, child) => {
    if (!isValidElement<PillSelectorItemProps>(child)) return width
    const { id, labelBehavior, activeWidth, inactiveWidth, icon } = child.props
    if (!id) return width + 36
    if (showFullLabel) return width + (activeWidth ?? TUNE_DEFAULT_ACTIVE_WIDTH)
    const behavior = labelBehavior ?? 'active-only'
    if (behavior === 'active-only' && icon) {
      return (
        width +
        (id === activeId
          ? (activeWidth ?? TUNE_DEFAULT_ACTIVE_WIDTH)
          : (inactiveWidth ?? TUNE_OPTION_WIDTH))
      )
    }
    return width + 160
  }, 0)
  const horizontalPadding = contained ? 2 : 32
  const borderWidth = contained ? 2 : 0
  return contentWidth + Math.max(0, items.length - 1) * gap + horizontalPadding + borderWidth
}

function getFullLabelHighlight(
  children: ReactNode,
  activeId: string,
  gap: number,
  contained: boolean,
) {
  let x = contained ? 1 : 16
  for (const child of Children.toArray(children).filter(Boolean)) {
    if (!isValidElement<PillSelectorItemProps>(child)) {
      x += 36 + gap
      continue
    }
    const width = child.props.activeWidth ?? TUNE_DEFAULT_ACTIVE_WIDTH
    if (child.props.id === activeId) return { x, width, color: child.props.color }
    x += width + gap
  }
  return { x: contained ? 1 : 16, width: 0, color: undefined }
}

export function PillSelector({
  activeId,
  children,
  centered = false,
  contained = false,
  fitContent = false,
  showFullLabel = false,
  variant = 'control',
  style,
  contentContainerStyle,
}: PillSelectorProps) {
  'use no memo'
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const scrollRef = useRef<ScrollView>(null)
  const addRef = useTriggerRef()
  const scrollEnabled = viewportWidth > 0 && contentWidth > viewportWidth + 1
  const gap = contained ? 0 : 8
  const fullLabelHighlight = getFullLabelHighlight(children, activeId, gap, contained)
  const highlightX = useSharedValue(fullLabelHighlight.x)
  const highlightWidth = useSharedValue(fullLabelHighlight.width)
  const highlightBackground = useResolvedColor(
    fullLabelHighlight.color?.bg ?? theme.palette.green.bg,
  )
  const highlightBorder = useResolvedColor(
    fullLabelHighlight.color?.border ?? theme.palette.green.border,
  )
  const highlightStyle = useAnimatedStyle(() => ({
    left: highlightX.value,
    width: highlightWidth.value,
  }))

  const openMenu = useCallback(
    (_id: string, triggerRef: React.RefObject<View | null>, content: ReactNode) => {
      setMenu({ triggerRef, content })
    },
    [],
  )

  const closeMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    if (!scrollEnabled) scrollRef.current?.scrollTo({ x: 0, animated: false })
  }, [scrollEnabled])

  useEffect(() => {
    highlightX.value = withTiming(fullLabelHighlight.x, TUNE_ANIMATION)
    highlightWidth.value = withTiming(fullLabelHighlight.width, TUNE_ANIMATION)
  }, [fullLabelHighlight.width, fullLabelHighlight.x, highlightWidth, highlightX])

  const fitContentStyle = fitContent
    ? {
        width: getFitContentWidth(children, activeId, contained ? 0 : 8, contained, showFullLabel),
      }
    : null

  return (
    <PillSelectorContext.Provider
      value={{ activeId, openMenu, closeMenu, addRef, contained, showFullLabel, variant }}
    >
      <View
        style={[styles.container, contained && styles.containedContainer, fitContentStyle, style]}
      >
        <ScrollView
          ref={scrollRef}
          horizontal
          scrollEnabled={scrollEnabled}
          bounces={scrollEnabled}
          showsHorizontalScrollIndicator={false}
          onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
          onContentSizeChange={(width) => setContentWidth(width)}
          contentContainerStyle={[
            styles.scrollContent,
            contained && styles.containedScrollContent,
            centered && styles.scrollContentCentered,
            contentContainerStyle,
          ]}
        >
          {showFullLabel ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.fullLabelHighlight,
                highlightStyle,
                { backgroundColor: highlightBackground, borderColor: highlightBorder },
              ]}
            />
          ) : null}
          {children}
        </ScrollView>

        <Dropdown
          visible={menu != null}
          triggerRef={menu?.triggerRef ?? addRef}
          onClose={closeMenu}
          matchTriggerWidth={false}
          minWidth={160}
          maxHeight={220}
        >
          {menu?.content}
        </Dropdown>
      </View>
    </PillSelectorContext.Provider>
  )
}

interface PillSelectorAddProps {
  testID?: string
  onPress: () => void
  style?: StyleProp<ViewStyle>
}

export function PillSelectorAdd({ testID, onPress, style }: PillSelectorAddProps) {
  const { addRef, contained, variant } = usePillSelectorCtx()
  const control = useResolvedControlColors()
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const useLightTabs = variant === 'lightTabs' && resolvedTheme === 'light'
  return (
    <Pressable
      ref={addRef}
      testID={testID}
      style={[
        styles.addPill,
        contained && styles.containedAddPill,
        useLightTabs && {
          backgroundColor: TRANSPARENT,
          borderColor: control.divider,
          borderWidth: 1,
          borderStyle: 'dashed',
        },
        style,
      ]}
      onPress={onPress}
    >
      <PlusIcon size={16} color={control.icon} weight="bold" />
    </Pressable>
  )
}

interface PillSelectorMenuItemProps {
  icon: Icon
  label: string
  testID?: string
  onPress: () => void
  danger?: boolean
  separator?: boolean
}

export function PillSelectorMenuItem({
  icon: IconComp,
  label,
  testID,
  onPress,
  danger,
  separator,
}: PillSelectorMenuItemProps) {
  const { closeMenu } = usePillSelectorCtx()
  return (
    <Pressable
      testID={testID}
      style={[styles.menuItem, separator && styles.menuItemSeparator]}
      onPress={() => {
        closeMenu()
        onPress()
      }}
    >
      <IconComp
        size={15}
        color={danger ? theme.status.error.text : theme.control.textMuted}
        weight="bold"
      />
      <Text style={[styles.menuItemText, danger && styles.menuItemTextDanger]}>{label}</Text>
    </Pressable>
  )
}

export interface PillSelectorDotProps {
  status: 'draft' | 'enabled' | 'disabled'
}

export function PillSelectorDot({ status }: PillSelectorDotProps) {
  if (status === 'draft') return <View style={styles.draftDot} />
  if (status === 'enabled') return <View style={styles.enabledDot} />
  return <View style={styles.disabledDot} />
}
