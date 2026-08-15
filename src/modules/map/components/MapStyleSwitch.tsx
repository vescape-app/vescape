import {
  MapOptionSelector,
  type MapOptionSelectorSize,
} from '@/components/controls/MapOptionSelector'
import { IS_MAPY_CONFIGURED } from '@/config/mapy'
import { useResolvedAccentColors } from '@/hooks/useTheme'
import { MAP_STYLES, type MapStyleKey } from '@/modules/map/constants/mapStyles'
import { theme } from '@/constants/theme'

interface MapStyleSwitchProps {
  activeKey: MapStyleKey
  expanded: boolean
  size?: MapOptionSelectorSize
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
  const activeAccent = effectiveActiveKey === 'outdoors' ? accents.yellow.light : accents.sky.text
  const options = availableStyles.map((style) => ({
    key: style.key,
    label: style.label,
    icon: (
      <style.Icon
        size={iconSize}
        color={effectiveActiveKey === style.key ? activeAccent : theme.neutral.textSecondary}
        weight={effectiveActiveKey === style.key ? 'fill' : 'bold'}
      />
    ),
  }))

  return (
    <MapOptionSelector
      activeKey={effectiveActiveKey}
      activeIcon={<activeStyle.Icon size={iconSize} color={activeAccent} weight="fill" />}
      activeColor={activeAccent}
      activeBackground={theme.alpha(activeAccent, 0.12)}
      collapsedAccessibilityLabel={`Basemap: ${activeStyle.label}`}
      expanded={expanded}
      size={size}
      options={options}
      onToggle={onToggle}
      onSelect={onSelect}
    />
  )
}
