import { Children, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import type { Icon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import {
  TUNE_ANIMATION,
  TUNE_DEFAULT_ACTIVE_WIDTH,
  TUNE_OPTION_WIDTH,
  styles,
  usePillSelectorCtx,
  type ActiveTheme,
  type PillSelectorLabelBehavior,
  type PillSelectorSlotVisibility,
} from '@/components/controls/pillSelectorShared'

const AnimatedText = Animated.createAnimatedComponent(Text)

interface PillSelectorResolvedState {
  active: boolean
  showLabel: boolean
  collapseLabel: boolean
  showHint: boolean
}

export interface PillSelectorItemProps {
  id: string
  label: string
  icon?: Icon
  labelBehavior?: PillSelectorLabelBehavior
  /** @deprecated Use labelBehavior="active-only". */
  activeLabelOnly?: boolean
  badge?: ReactNode
  hint?: ReactNode
  hintVisibility?: PillSelectorSlotVisibility
  hintGap?: number
  color?: ActiveTheme
  activeWidth?: number
  inactiveWidth?: number
  testID?: string
  onPress: () => void
  children?: ReactNode
}

function slotVisible(visibility: PillSelectorSlotVisibility, active: boolean) {
  if (visibility === 'always') return true
  return visibility === 'active' ? active : !active
}

function resolveItemState({
  active,
  icon,
  activeLabelOnly,
  labelBehavior,
  hintVisibility,
}: {
  active: boolean
  icon?: Icon
  activeLabelOnly?: boolean
  labelBehavior?: PillSelectorLabelBehavior
  hintVisibility: PillSelectorSlotVisibility
}): PillSelectorResolvedState {
  const resolvedLabelBehavior = activeLabelOnly ? 'active-only' : (labelBehavior ?? 'active-only')
  const collapseLabel = resolvedLabelBehavior === 'active-only' && icon != null
  return {
    active,
    collapseLabel,
    showLabel: !collapseLabel || active,
    showHint: slotVisible(hintVisibility, active),
  }
}

interface PillSelectorItemContentProps extends PillSelectorResolvedState {
  label: string
  icon?: Icon
  accentColor: string
  inactiveAccent: string
  hint?: ReactNode
  hintGap: number
  badge?: ReactNode
  labelStyle: object
}

function PillSelectorItemContent({
  label,
  icon: IconComp,
  active,
  collapseLabel,
  showLabel,
  showHint,
  accentColor,
  inactiveAccent,
  hint,
  hintGap,
  badge,
  labelStyle,
}: PillSelectorItemContentProps) {
  const textStateStyle = active
    ? { color: accentColor, fontWeight: '800' as const }
    : { color: inactiveAccent }

  return (
    <>
      {IconComp ? (
        <IconComp
          size={collapseLabel ? 18 : 14}
          color={active ? accentColor : inactiveAccent}
          weight="duotone"
        />
      ) : null}
      {collapseLabel ? (
        <AnimatedText style={[styles.pillText, textStateStyle, labelStyle]} numberOfLines={1}>
          {label}
        </AnimatedText>
      ) : showLabel ? (
        <Text style={[styles.pillText, textStateStyle]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      {hint && showHint ? <View style={[styles.hint, { marginLeft: hintGap }]}>{hint}</View> : null}
      {badge}
    </>
  )
}

export function PillSelectorItem({
  id,
  label,
  icon: IconComp,
  labelBehavior,
  activeLabelOnly,
  badge,
  hint,
  hintVisibility = 'inactive',
  hintGap = 2,
  color,
  activeWidth = TUNE_DEFAULT_ACTIVE_WIDTH,
  inactiveWidth = TUNE_OPTION_WIDTH,
  testID,
  onPress,
  children,
}: PillSelectorItemProps) {
  const { activeId, contained, openMenu, closeMenu } = usePillSelectorCtx()
  const pillRef = useRef<View>(null)
  const active = id === activeId
  const resolved = resolveItemState({
    active,
    icon: IconComp,
    activeLabelOnly,
    labelBehavior,
    hintVisibility,
  })
  const accentBg = color?.bg ?? theme.palette.green.bg
  const accentBorder = color?.border ?? theme.palette.green.border
  const accentColor = color?.color ?? theme.palette.green.color
  const inactiveAccent = theme.alpha(accentColor, 0.6)
  const activeProgress = useSharedValue(active ? 1 : 0)
  const labelProgress = useSharedValue(resolved.showLabel ? 1 : 0)

  useEffect(() => {
    activeProgress.value = withTiming(active ? 1 : 0, TUNE_ANIMATION)
  }, [active, activeProgress])

  useEffect(() => {
    labelProgress.value = withTiming(resolved.showLabel ? 1 : 0, TUNE_ANIMATION)
  }, [labelProgress, resolved.showLabel])

  const frameStyle = useAnimatedStyle(
    () => ({
      width: resolved.collapseLabel
        ? inactiveWidth + (activeWidth - inactiveWidth) * activeProgress.value
        : undefined,
      backgroundColor: interpolateColor(
        activeProgress.value,
        [0, 1],
        [
          contained ? theme.alpha(theme.palette.mono.black, 0) : theme.palette.slate.surface,
          accentBg,
        ],
      ),
      borderColor: interpolateColor(
        activeProgress.value,
        [0, 1],
        [
          contained ? theme.alpha(theme.palette.mono.black, 0) : theme.palette.slate.border,
          accentBorder,
        ],
      ),
    }),
    [accentBg, accentBorder, activeWidth, resolved.collapseLabel, contained, inactiveWidth],
  )
  const labelStyle = useAnimatedStyle(
    () => ({
      opacity: labelProgress.value,
      maxWidth: activeWidth * labelProgress.value,
      marginLeft: (IconComp ? 6 : 0) * labelProgress.value,
    }),
    [IconComp, activeWidth],
  )

  const menuItems = Children.toArray(children).filter(Boolean)
  const hasMenu = menuItems.length > 0
  const longPressedRef = useRef(false)

  const handleLongPress = useCallback(() => {
    if (!hasMenu) return
    longPressedRef.current = true
    const menuContent = <View style={styles.menu}>{menuItems}</View>
    openMenu(id, pillRef, menuContent)
  }, [id, menuItems, hasMenu, openMenu])

  return (
    <Animated.View
      ref={pillRef}
      style={[
        styles.pill,
        resolved.collapseLabel && styles.iconPill,
        resolved.collapseLabel && { maxWidth: activeWidth },
        contained && styles.containedPill,
        frameStyle,
      ]}
    >
      <Pressable
        testID={testID}
        style={[styles.pillPressable, resolved.collapseLabel && styles.collapsingPillPressable]}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        onPress={() => {
          if (longPressedRef.current) {
            longPressedRef.current = false
            return
          }
          closeMenu()
          onPress()
        }}
        onLongPress={hasMenu ? handleLongPress : undefined}
        delayLongPress={400}
      >
        <PillSelectorItemContent
          {...resolved}
          label={label}
          icon={IconComp}
          accentColor={accentColor}
          inactiveAccent={inactiveAccent}
          hint={hint}
          hintGap={hintGap}
          badge={badge}
          labelStyle={labelStyle}
        />
      </Pressable>
    </Animated.View>
  )
}
