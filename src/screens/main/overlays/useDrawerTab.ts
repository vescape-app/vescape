import { useCallback, useState } from 'react'

import type { DrawerTab } from '@/components/overlays/TabbedEdgeDrawer'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

type DrawerTabSetting = 'boardDrawerTab' | 'historyDrawerTab' | 'socialDrawerTab'

/**
 * The tab a corner drawer opens on, and its trigger wears: the last one the rider opened, kept
 * across launches, or the drawer's main tab until there is one. A stored id that is no longer a
 * tab falls back to the main tab rather than leaving the drawer on nothing.
 */
export function useDrawerTab<Id extends string>(
  setting: DrawerTabSetting,
  tabs: readonly DrawerTab<Id>[],
  mainTab: Id,
) {
  const stored = useSettingsStore((state) => state[setting])
  const set = useSettingsStore((state) => state.set)
  // The switch answers the tap now; the native write only has to land before the next launch.
  const [picked, setPicked] = useState<Id | null>(null)
  const id = picked ?? tabs.find((tab) => tab.id === stored)?.id ?? mainTab
  const setTab = useCallback(
    (next: Id) => {
      setPicked(next)
      // intentional-suppression: a lost tab preference only reopens the drawer on its main tab
      void set(setting, next).catch(() => undefined)
    },
    [set, setting],
  )
  const icon = tabs.find((tab) => tab.id === id)?.icon ?? tabs[0].icon
  return { tab: id, setTab, icon }
}
