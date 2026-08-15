import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  isValidElement,
  type ReactNode,
} from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { Text } from '@/components/base/Text'
import { PlusIcon } from 'phosphor-react-native'
import type { Icon } from 'phosphor-react-native'

import { Dropdown, useTriggerRef } from '@/components/forms/Dropdown'
import { theme } from '@/constants/theme'
import {
  useResolvedColor,
  useResolvedControlColors,
  useResolvedNeutralColors,
  useThemeStore,
} from '@/hooks/useTheme'

interface ActiveTheme {
  bg: string
  border: string
  color: string
}

interface MenuState {
  triggerRef: React.RefObject<View | null>
  content: ReactNode
}

interface PillSelectorCtx {
  activeId: string
  openMenu: (id: string, triggerRef: React.RefObject<View | null>, content: ReactNode) => void
  closeMenu: () => void
  addRef: React.RefObject<View | null>
  contained: boolean
  variant: 'control' | 'lightTabs'
}

const PillSelectorContext = createContext<PillSelectorCtx | null>(null)
const TUNE_OPTION_WIDTH = 38
const TUNE_DEFAULT_ACTIVE_WIDTH = 112
const TUNE_ANIMATION = { duration: 180 } as const
const TRANSPARENT = theme.alpha(theme.palette.mono.black, 0)
const AnimatedText = Animated.createAnimatedComponent(Text)
type PillSelectorLabelBehavior = 'active-only' | 'always'
type PillSelectorSlotVisibility = 'active' | 'inactive' | 'always'
interface PillSelectorResolvedState {
  active: boolean
  showLabel: boolean
  collapseLabel: boolean
  showBadge: boolean
  showHint: boolean
}

function usePillSelectorCtx() {
  const ctx = useContext(PillSelectorContext)
  if (!ctx) throw new Error('PillSelectorItem must be inside PillSelector')
  return ctx
}

interface PillSelectorProps {
  activeId: string
  children: ReactNode
  centered?: boolean
  contained?: boolean
  fitContent?: boolean
  variant?: 'control' | 'lightTabs'
  style?: StyleProp<ViewStyle>
  contentContainerStyle?: StyleProp<ViewStyle>
}

function getFitContentWidth(children: ReactNode, activeId: string, gap: number) {
  const items = Children.toArray(children).filter(Boolean)
  const contentWidth = items.reduce<number>((width, child) => {
    if (!isValidElement<PillSelectorItemProps>(child)) return width
    const { id, activeLabelOnly, labelBehavior, activeWidth, inactiveWidth, icon } = child.props
    if (!id) return width + 36
    const behavior = activeLabelOnly ? 'active-only' : (labelBehavior ?? 'active-only')
    if (behavior === 'active-only' && icon) {
      return (
        width +
        (id === activeId
          ? (activeWidth ?? TUNE_DEFAULT_ACTIVE_WIDTH)
          : (inactiveWidth ?? TUNE_OPTION_WIDTH))
      )
    }
    return width + 160
  }, 2)
  return contentWidth + Math.max(0, items.length - 1) * gap
}

export function PillSelector({
  activeId,
  children,
  centered = false,
  contained = false,
  fitContent = false,
  variant = 'control',
  style,
  contentContainerStyle,
}: PillSelectorProps) {
  'use no memo'
  const [menu, setMenu] = useState<MenuState | null>(null)
  const neutral = useResolvedNeutralColors()
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const useLightTabs = variant === 'lightTabs' && resolvedTheme === 'light'
  const addRef = useTriggerRef()

  const openMenu = useCallback(
    (_id: string, triggerRef: React.RefObject<View | null>, content: ReactNode) => {
      setMenu({ triggerRef, content })
    },
    [],
  )

  const closeMenu = useCallback(() => setMenu(null), [])

  const fitContentStyle = fitContent
    ? { width: getFitContentWidth(children, activeId, contained ? 0 : 8) }
    : null

  return (
    <PillSelectorContext.Provider
      value={{ activeId, openMenu, closeMenu, addRef, contained, variant }}
    >
      <View
        style={[
          styles.container,
          contained && styles.containedContainer,
          useLightTabs && {
            backgroundColor: neutral.surface,
            borderColor: neutral.border,
          },
          fitContentStyle,
          style,
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            contained && styles.containedScrollContent,
            centered && styles.scrollContentCentered,
            contentContainerStyle,
          ]}
        >
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

interface PillSelectorItemProps {
  id: string
  label: string
  icon?: Icon
  labelBehavior?: PillSelectorLabelBehavior
  /** @deprecated Use labelBehavior="active-only". */
  activeLabelOnly?: boolean
  badge?: ReactNode
  badgeVisibility?: PillSelectorSlotVisibility
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
  badgeVisibility,
  hintVisibility,
}: {
  active: boolean
  icon?: Icon
  activeLabelOnly?: boolean
  labelBehavior?: PillSelectorLabelBehavior
  badgeVisibility: PillSelectorSlotVisibility
  hintVisibility: PillSelectorSlotVisibility
}): PillSelectorResolvedState {
  const resolvedLabelBehavior = activeLabelOnly ? 'active-only' : (labelBehavior ?? 'active-only')
  const collapseLabel = resolvedLabelBehavior === 'active-only' && icon != null
  return {
    active,
    collapseLabel,
    showLabel: !collapseLabel || active,
    showBadge: slotVisible(badgeVisibility, active),
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
  showBadge,
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
      {badge && showBadge ? badge : null}
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
  badgeVisibility = 'always',
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
  const control = useResolvedControlColors()
  const neutral = useResolvedNeutralColors()
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const { activeId, contained, variant, openMenu, closeMenu } = usePillSelectorCtx()
  const useLightTabs = variant === 'lightTabs' && resolvedTheme === 'light'
  const pillRef = useRef<View>(null)
  const active = id === activeId
  const resolved = resolveItemState({
    active,
    icon: IconComp,
    activeLabelOnly,
    labelBehavior,
    badgeVisibility,
    hintVisibility,
  })
  const accentBorder = useResolvedColor(color?.border ?? theme.palette.green.border)
  const accentColor = useResolvedColor(color?.color ?? theme.palette.green.color)
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
          useLightTabs ? neutral.surface : contained ? TRANSPARENT : control.background,
          useLightTabs ? control.background : control.backgroundPressed,
        ],
      ),
      borderColor: interpolateColor(
        activeProgress.value,
        [0, 1],
        [useLightTabs ? TRANSPARENT : contained ? TRANSPARENT : control.border, accentBorder],
      ),
    }),
    [
      accentBorder,
      activeWidth,
      resolved.collapseLabel,
      contained,
      inactiveWidth,
      control.background,
      control.backgroundPressed,
      control.border,
      neutral.border,
      neutral.surface,
      useLightTabs,
    ],
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
        useLightTabs && styles.lightTabPill,
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

interface PillSelectorAddProps {
  testID?: string
  onPress: () => void
}

export function PillSelectorAdd({ testID, onPress }: PillSelectorAddProps) {
  const { addRef, contained } = usePillSelectorCtx()
  return (
    <Pressable
      ref={addRef}
      testID={testID}
      style={[styles.addPill, contained && styles.containedAddPill]}
      onPress={onPress}
    >
      <PlusIcon size={14} color={theme.control.icon} weight="bold" />
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

const styles = StyleSheet.create({
  container: {
    marginHorizontal: -16,
  },
  containedContainer: {
    height: 38,
    marginHorizontal: 0,
    borderRadius: 19,
    overflow: 'hidden',
    backgroundColor: theme.control.background,
    borderWidth: 1,
    borderColor: theme.control.border,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
    minWidth: '100%',
  },
  containedScrollContent: {
    minWidth: 0,
    height: 36,
    paddingHorizontal: 1,
    gap: 0,
  },
  scrollContentCentered: {
    justifyContent: 'center',
  },
  pill: {
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    maxWidth: 160,
    overflow: 'hidden',
  },
  iconPill: {
    height: TUNE_OPTION_WIDTH,
    width: TUNE_OPTION_WIDTH,
    maxWidth: TUNE_DEFAULT_ACTIVE_WIDTH,
    paddingHorizontal: 0,
    borderRadius: TUNE_OPTION_WIDTH / 2,
    overflow: 'hidden',
  },
  containedPill: {
    height: 36,
    borderRadius: 18,
    borderWidth: 0,
  },
  lightTabPill: {
    borderWidth: 1,
  },
  pillPressable: {
    height: 36,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  collapsingPillPressable: {
    width: '100%',
    height: '100%',
    gap: 0,
    paddingHorizontal: 10,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  pillTextInactive: {
    color: theme.control.textMuted,
  },
  addPill: {
    height: 36,
    width: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.control.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  containedAddPill: {
    borderWidth: 0,
    borderStyle: 'solid',
    backgroundColor: theme.alpha(theme.palette.mono.black, 0),
  },
  menu: {
    paddingVertical: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
  },
  menuItemSeparator: {
    borderTopWidth: 1,
    borderTopColor: theme.control.divider,
  },
  menuItemText: {
    color: theme.control.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  menuItemTextDanger: {
    color: theme.status.error.text,
  },
  draftDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.control.textMuted,
  },
  enabledDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.palette.green.color,
  },
  disabledDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: theme.control.textMuted,
  },
})
