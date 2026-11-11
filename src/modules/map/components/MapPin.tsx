import type { ThemeColor } from '@/constants/theme'
import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { Marker } from '@maplibre/maplibre-react-native'
import type { Icon } from 'phosphor-react-native'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'

interface MapPinProps {
  id: string
  coordinate: [number, number]
  color: ThemeColor
  icon?: Icon
  iconColor?: ThemeColor
  selected?: boolean
  navigationActive?: boolean
  expandSelected?: boolean
  label?: string
  onSelected?: () => void
}

const MAP_PIN_ICON_METRICS = {
  default: {
    size: 22,
    radius: 11,
    borderWidth: 1.5,
    iconSize: 12,
    opacity: 0.78,
  },
  selected: {
    size: 32,
    radius: 16,
    borderWidth: 2.5,
    iconSize: 18,
    opacity: 1,
  },
  navigation: {
    size: 40,
    radius: 20,
    borderWidth: 3,
    iconSize: 23,
    opacity: 1,
  },
  expanded: {
    size: 42,
    radius: 21,
    borderWidth: 2.5,
    iconSize: 22,
    opacity: 1,
  },
} as const

export function MapPin({
  id,
  coordinate,
  color,
  icon: IconComponent,
  iconColor,
  selected = false,
  navigationActive = false,
  expandSelected = false,
  label,
  onSelected,
}: MapPinProps) {
  const neutral = useResolvedNeutralColors()
  const resolvedColor = useResolvedColor(color)
  const resolvedIconColor = useResolvedColor(iconColor ?? color)

  if (IconComponent) {
    if (selected && expandSelected && label) {
      const metrics = MAP_PIN_ICON_METRICS.expanded
      return (
        <Marker id={id} lngLat={coordinate} onPress={onSelected}>
          <View style={styles.selectedMapPoint}>
            <View
              style={[
                styles.iconPin,
                iconPinStyle(metrics, resolvedColor),
                { backgroundColor: neutral.surface },
              ]}
            >
              <IconComponent size={metrics.iconSize} color={resolvedIconColor} weight="bold" />
            </View>
            <View style={[styles.selectedMapPointExtension, { backgroundColor: neutral.surface }]}>
              <Text
                numberOfLines={1}
                style={[styles.selectedMapPointLabel, { color: neutral.textPrimary }]}
              >
                {label}
              </Text>
            </View>
          </View>
        </Marker>
      )
    }

    const metrics = navigationActive
      ? MAP_PIN_ICON_METRICS.navigation
      : selected
        ? MAP_PIN_ICON_METRICS.selected
        : MAP_PIN_ICON_METRICS.default
    return (
      <Marker id={id} lngLat={coordinate} onPress={onSelected}>
        <View style={styles.iconPinFrame}>
          <View
            style={[
              styles.iconPin,
              iconPinStyle(metrics, resolvedColor),
              selected && styles.iconPinSelected,
              { backgroundColor: neutral.surface },
            ]}
          >
            <IconComponent size={metrics.iconSize} color={resolvedIconColor} weight="bold" />
          </View>
        </View>
      </Marker>
    )
  }

  return (
    <Marker id={id} lngLat={coordinate} onPress={onSelected}>
      <View style={[styles.pin, { backgroundColor: neutral.surface, borderColor: resolvedColor }]}>
        <View style={[styles.pinCore, { backgroundColor: resolvedColor }]} />
      </View>
    </Marker>
  )
}

function iconPinStyle(
  metrics: (typeof MAP_PIN_ICON_METRICS)[keyof typeof MAP_PIN_ICON_METRICS],
  color: string,
) {
  return {
    width: metrics.size,
    height: metrics.size,
    borderRadius: metrics.radius,
    borderWidth: metrics.borderWidth,
    borderColor: color,
    opacity: metrics.opacity,
  }
}

const styles = StyleSheet.create({
  pin: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 3,
  },
  iconPin: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPinFrame: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPinSelected: {
    opacity: 1,
    zIndex: 2,
  },
  selectedMapPoint: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedMapPointExtension: {
    position: 'absolute',
    left: 40,
    minWidth: 88,
    maxWidth: 174,
    height: 34,
    paddingLeft: 14,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 18,
    zIndex: 1,
  },
  selectedMapPointLabel: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '800',
  },
  pinCore: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
  },
})
