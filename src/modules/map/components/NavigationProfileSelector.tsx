import { CarIcon, PersonSimpleBikeIcon, PersonSimpleWalkIcon } from 'phosphor-react-native'
import { useState, type ComponentType } from 'react'
import type { NavigationProfile } from 'vescape-core'

import {
  ExpandableCircleMenu,
  type ExpandableCircleMenuSize,
} from '@/components/controls/ExpandableCircleMenu'
import { theme } from '@/constants/theme'
import {
  useColoredActionForeground,
  useResolvedAccentColors,
  useResolvedControlColors,
  useThemeStore,
} from '@/hooks/useTheme'

export function NavigationProfileSelector({
  activeProfile,
  size = 'md',
  open = false,
  onSelect,
}: {
  activeProfile: NavigationProfile
  size?: ExpandableCircleMenuSize
  open?: boolean
  onSelect: (profile: NavigationProfile) => void
}) {
  const accents = useResolvedAccentColors()
  const control = useResolvedControlColors()
  const appearance = useThemeStore((state) => state.resolvedTheme)
  const light = appearance === 'light'
  const activeForeground = useColoredActionForeground(theme.palette.green.color)
  const [expanded, setExpanded] = useState(false)
  const iconSize = size === 'sm' ? 18 : 21
  const optionIconSize = size === 'sm' ? 17 : 20

  const options = NAVIGATION_PROFILE_OPTIONS.map(({ key, label, Icon }) => ({
    key,
    label,
    icon: (
      <Icon
        size={optionIconSize}
        color={
          activeProfile === key
            ? light
              ? activeForeground
              : accents.green.color
            : light
              ? accents.green.color
              : control.textMuted
        }
        weight="bold"
      />
    ),
  }))
  const ActiveIcon = profileOption(activeProfile).Icon

  return (
    <ExpandableCircleMenu
      activeKey={activeProfile}
      activeIcon={
        <ActiveIcon
          size={iconSize}
          color={light ? activeForeground : theme.palette.mono.white}
          weight="bold"
        />
      }
      activeColor={theme.palette.green.color}
      activeBackground={theme.control.background}
      collapsedAccessibilityLabel={`Path follows: ${profileOption(activeProfile).label}`}
      expanded={open || expanded}
      variant="lightTabs"
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
