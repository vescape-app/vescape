import type { RefObject } from 'react'
import type { View } from 'react-native'
import { UserCircleIcon, UsersThreeIcon } from 'phosphor-react-native'

import { TabbedEdgeDrawer, type DrawerTab } from '@/components/overlays/TabbedEdgeDrawer'
import { theme } from '@/constants/theme'
import { GroupRideWidget, RiderNameWidget } from '@/modules/group-ride/components/SocialWidgets'
import { useDrawerTab } from '@/screens/main/overlays/useDrawerTab'

type SocialTab = 'groupRide' | 'profile'

const SOCIAL_TABS: readonly DrawerTab<SocialTab>[] = [
  {
    id: 'groupRide',
    label: 'Group Ride',
    icon: UsersThreeIcon,
    color: theme.palette.groupRide.color,
  },
  { id: 'profile', label: 'Profile', icon: UserCircleIcon, color: theme.palette.purple.color },
]

export function useSocialDrawerTab() {
  return useDrawerTab('socialDrawerTab', SOCIAL_TABS, 'groupRide')
}

interface SocialDrawerProps {
  visible: boolean
  triggerRef: RefObject<View | null>
  tab: SocialTab
  onTabChange: (tab: SocialTab) => void
  onClose: () => void
}

/** Social, opened from the top-left button: Group Ride and the rider's own profile. */
export function SocialDrawer({
  visible,
  triggerRef,
  tab,
  onTabChange,
  onClose,
}: SocialDrawerProps) {
  return (
    <TabbedEdgeDrawer
      visible={visible}
      triggerRef={triggerRef}
      edge="top"
      side="left"
      tabs={SOCIAL_TABS}
      activeTab={tab}
      onTabChange={onTabChange}
      onClose={onClose}
      backdropTestID="social-drawer-backdrop"
      testID="social-sheet"
    >
      {tab === 'groupRide' ? <GroupRideWidget /> : <RiderNameWidget />}
    </TabbedEdgeDrawer>
  )
}
