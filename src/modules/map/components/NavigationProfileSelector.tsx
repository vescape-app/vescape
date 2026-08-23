import { CarIcon, PersonSimpleBikeIcon, PersonSimpleWalkIcon } from 'phosphor-react-native'
import { useState, type ComponentType } from 'react'
import type { NavigationProfile } from 'vescape-core'

import {
  ExpandableCircleMenu,
  type ExpandableCircleMenuSize,
} from '@/components/controls/ExpandableCircleMenu'
import { theme } from '@/constants/theme'

/**
 * Which kind of ways the path may follow, switched inline while looking at it. Deliberately not a
 * settings screen entry: the rider decides a path went the wrong kind of way and fixes it there.
 *
 * It shows the profile that produced the drawn path, not the one stored for next time — a switch
 * whose recompute found nothing leaves the old path, and this snaps back with it.
 *
 * `open` lays every profile out at once. On the path view that is the right shape: the rider is
 * already deciding which ways the path may follow, and making them tap once to reveal the choices
 * and again to pick one puts a shrug in the middle of a decision they have already made.
 */
export function NavigationProfileSelector({
  activeProfile,
  size = 'md',
  open = false,
  onSelect,
}: {
  activeProfile: NavigationProfile
  size?: ExpandableCircleMenuSize
  /** Show all profiles side by side instead of collapsing to the active one. */
  open?: boolean
  onSelect: (profile: NavigationProfile) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const iconSize = size === 'sm' ? 18 : 21
  const optionIconSize = size === 'sm' ? 17 : 20

  const options = NAVIGATION_PROFILE_OPTIONS.map(({ key, label, Icon }) => ({
    key,
    label,
    icon: (
      <Icon
        size={optionIconSize}
        color={activeProfile === key ? ACTIVE_COLOR : theme.palette.slate.textSecondary}
        weight="bold"
      />
    ),
  }))
  const ActiveIcon = profileOption(activeProfile).Icon

  return (
    <ExpandableCircleMenu
      activeKey={activeProfile}
      activeIcon={<ActiveIcon size={iconSize} color={theme.palette.mono.white} weight="bold" />}
      activeColor={ACTIVE_COLOR}
      activeBackground={theme.alpha(theme.palette.green.color, 0.12)}
      collapsedAccessibilityLabel={`Path follows: ${profileOption(activeProfile).label}`}
      expanded={open || expanded}
      autoCloseDelayMs={open ? null : undefined}
      size={size}
      options={options}
      onToggle={() => {
        if (open) return
        setExpanded((current) => !current)
      }}
      onSelect={(profile) => {
        setExpanded(false)
        onSelect(profile)
      }}
    />
  )
}

const ACTIVE_COLOR = theme.palette.green.text

/**
 * Rider-facing names for the profiles. They say what the path follows rather than how the rider
 * travels: an EUC is none of walking, cycling or driving, but the ways are exactly the difference.
 */
const NAVIGATION_PROFILE_OPTIONS: {
  key: NavigationProfile
  label: string
  Icon: ComponentType<{ size: number; color: string; weight: 'bold' }>
}[] = [
  { key: 'walking', label: 'Paths', Icon: PersonSimpleWalkIcon },
  { key: 'cycling', label: 'Cycleways', Icon: PersonSimpleBikeIcon },
  { key: 'driving', label: 'Roads', Icon: CarIcon },
]

function profileOption(profile: NavigationProfile) {
  return NAVIGATION_PROFILE_OPTIONS.find((option) => option.key === profile) ?? WALKING_OPTION
}

const WALKING_OPTION = NAVIGATION_PROFILE_OPTIONS[0]!
