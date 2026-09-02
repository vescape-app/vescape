import {
  ExpandableCircleMenu,
  type ExpandableCircleMenuSize,
} from '@/components/controls/ExpandableCircleMenu'
import { IS_MAPY_CONFIGURED } from '@/config/mapy'
import { useResolvedAccentColors } from '@/hooks/useTheme'
import { MAP_STYLES, type MapStyleKey } from '@/modules/map/constants/mapStyles'
import { theme } from '@/constants/theme'

interface MapStyleSwitchProps {
  activeKey: MapStyleKey
  expanded: boolean
  size?: ExpandableCircleMenuSize
  onToggle: () => void
  onSelect: (key: MapStyleKey) => void
}

export function MapStyleSwitch({
  activeKey,
  expanded,
  size = 'md',
  onToggle,
  onSelect,
}: MapStyleSwitchProps) {
  const accents = useResolvedAccentColors()
  const iconSize = size === 'sm' ? 18 : 21
  const availableStyles = IS_MAPY_CONFIGURED
    ? MAP_STYLES
    : MAP_STYLES.filter((style) => style.key !== 'mapy')
  const effectiveActiveKey =
    activeKey === 'mapy' && !IS_MAPY_CONFIGURED ? MAP_STYLES[0].key : activeKey
  const activeStyle =
    availableStyles.find((style) => style.key === effectiveActiveKey) ?? MAP_STYLES[0]
  const activeAccent = effectiveActiveKey === 'outdoors' ? accents.yellow.color : accents.sky.color
  const options = availableStyles.map((style) => ({
    key: style.key,
    label: style.label,
    icon: (
      <style.Icon
        size={iconSize}
        color={effectiveActiveKey === style.key ? activeAccent : theme.palette.mono.white}
        weight={effectiveActiveKey === style.key ? 'fill' : 'bold'}
      />
    ),
  }))

  return (
    <ExpandableCircleMenu
      activeKey={effectiveActiveKey}
      activeIcon={<activeStyle.Icon size={iconSize} color={activeAccent} weight="fill" />}
      activeColor={activeAccent}
      activeBackground={theme.alpha(activeAccent, 0.12)}
      collapsedAccessibilityLabel={`Basemap: ${activeStyle.label}`}
      expanded={expanded}
      variant="lightTabs"
      size={size}
      options={options}
      onToggle={onToggle}
      onSelect={onSelect}
    />
  )
}
