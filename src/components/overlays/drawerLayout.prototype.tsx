/**
 * PROTOTYPE — wipe me (and `drawerLayoutVariants/`) once a layout wins.
 *
 * Question: how should a tabbed corner drawer lay out its tabs and view around the trigger it
 * grows out of? Each variant in `drawerLayoutVariants/` renders the whole anchored body; a dev-only
 * bar inside the drawer flips between them live.
 */
import { useSyncExternalStore } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { CaretLeftIcon, CaretRightIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { ArcFan } from '@/components/overlays/drawerLayoutVariants/ArcFan'
import { FolderTabs } from '@/components/overlays/drawerLayoutVariants/FolderTabs'
import { HorizontalBar } from '@/components/overlays/drawerLayoutVariants/HorizontalBar'
import { PillColumn } from '@/components/overlays/drawerLayoutVariants/PillColumn'
import { SpeedDial } from '@/components/overlays/drawerLayoutVariants/SpeedDial'
import { SwipePager } from '@/components/overlays/drawerLayoutVariants/SwipePager'
import { theme } from '@/constants/theme'

export const DRAWER_LAYOUT_VARIANTS = [
  { key: '1', name: 'Pill column', Component: PillColumn },
  { key: '2', name: 'Horizontal bar', Component: HorizontalBar },
  { key: '3', name: 'Arc fan', Component: ArcFan },
  { key: '4', name: 'Folder tabs', Component: FolderTabs },
  { key: '5', name: 'Swipe pager', Component: SwipePager },
  { key: '6', name: 'Speed dial', Component: SpeedDial },
] as const

export type DrawerLayoutVariant = (typeof DRAWER_LAYOUT_VARIANTS)[number]['key']

let current: DrawerLayoutVariant = '1'
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useDrawerLayoutVariant() {
  const key = useSyncExternalStore(subscribe, () => current)
  return DRAWER_LAYOUT_VARIANTS.find((variant) => variant.key === key) ?? DRAWER_LAYOUT_VARIANTS[0]
}

function step(direction: 1 | -1) {
  const index = DRAWER_LAYOUT_VARIANTS.findIndex((variant) => variant.key === current)
  const count = DRAWER_LAYOUT_VARIANTS.length
  current = DRAWER_LAYOUT_VARIANTS[(index + direction + count) % count].key
  listeners.forEach((listener) => listener())
}

export function DrawerLayoutSwitcher() {
  const variant = useDrawerLayoutVariant()
  if (!__DEV__) return null
  return (
    <View style={styles.bar} pointerEvents="box-none">
      <View style={styles.pill}>
        <Pressable onPress={() => step(-1)} hitSlop={12} testID="drawer-layout-prev">
          <CaretLeftIcon size={22} color={theme.palette.mono.black} weight="bold" />
        </Pressable>
        <Text style={styles.label}>
          {variant.key} — {variant.name}
        </Text>
        <Pressable onPress={() => step(1)} hitSlop={12} testID="drawer-layout-next">
          <CaretRightIcon size={22} color={theme.palette.mono.black} weight="bold" />
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 64,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: theme.palette.amber.light,
  },
  label: {
    color: theme.palette.mono.black,
    fontSize: 14,
    fontWeight: '800',
  },
})
