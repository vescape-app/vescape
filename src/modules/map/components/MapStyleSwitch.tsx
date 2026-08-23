import {
  ExpandableCircleMenu,
  type ExpandableCircleMenuSize,
} from '@/components/controls/ExpandableCircleMenu'
import { IS_MAPY_CONFIGURED } from '@/config/mapy'
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
  const iconSize = size === 'sm' ? 18 : 21
  const availableStyles = IS_MAPY_CONFIGURED
    ? MAP_STYLES
    : MAP_STYLES.filter((style) => style.key !== 'mapy')
  const effectiveActiveKey =
    activeKey === 'mapy' && !IS_MAPY_CONFIGURED ? MAP_STYLES[0].key : activeKey
  const activeStyle =
    availableStyles.find((style) => style.key === effectiveActiveKey) ?? MAP_STYLES[0]
  const options = availableStyles.map((style) => ({
    key: style.key,
    label: style.label,
    icon: (
      <style.Icon
        size={iconSize}
        color={
          effectiveActiveKey === style.key
            ? theme.palette.sky.text
            : theme.palette.slate.textSecondary
        }
        weight={effectiveActiveKey === style.key ? 'fill' : 'bold'}
      />
    ),
  }))

  return (
    <ExpandableCircleMenu
      activeKey={effectiveActiveKey}
      activeIcon={<activeStyle.Icon size={iconSize} color={theme.palette.sky.text} weight="fill" />}
      activeColor={theme.palette.sky.text}
      activeBackground={theme.alpha(theme.palette.sky.color, 0.12)}
      collapsedAccessibilityLabel={`Basemap: ${activeStyle.label}`}
      expanded={expanded}
      size={size}
      options={options}
      onToggle={onToggle}
      onSelect={onSelect}
    />
  )
}
