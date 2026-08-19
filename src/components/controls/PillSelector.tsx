import { Children, isValidElement, useCallback, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { PlusIcon } from 'phosphor-react-native'
import type { Icon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { Dropdown, useTriggerRef } from '@/components/forms/Dropdown'
import { theme } from '@/constants/theme'
import { useResolvedControlColors, useThemeStore } from '@/hooks/useTheme'
import type { PillSelectorItemProps } from '@/components/controls/PillSelectorItem'
import {
  PillSelectorContext,
  TRANSPARENT,
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
  variant?: 'control' | 'lightTabs'
  style?: StyleProp<ViewStyle>
  contentContainerStyle?: StyleProp<ViewStyle>
}

function getFitContentWidth(children: ReactNode, activeId: string, gap: number) {
  const items = Children.toArray(children).filter(Boolean)
  const contentWidth = items.reduce<number>((width, child) => {
    if (!isValidElement<PillSelectorItemProps>(child)) return width
    const { id, labelBehavior, activeWidth, inactiveWidth, icon } = child.props
    if (!id) return width + 36
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
        style={[styles.container, contained && styles.containedContainer, fitContentStyle, style]}
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
