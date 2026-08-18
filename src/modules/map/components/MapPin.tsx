import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { MarkerView, PointAnnotation } from '@rnmapbox/maps'
import type { Icon } from 'phosphor-react-native'
import { theme } from '@/constants/theme'

interface MapPinProps {
  id: string
  coordinate: [number, number]
  color: string
  icon?: Icon
  iconColor?: string
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
  if (IconComponent) {
    if (selected && expandSelected && label) {
      const metrics = MAP_PIN_ICON_METRICS.expanded
      return (
        <MarkerView coordinate={coordinate} allowOverlap>
          <View style={styles.selectedMapPoint}>
            <Pressable
              style={[styles.iconPin, iconPinStyle(metrics, color), styles.iconPinExpanded]}
              onPress={onSelected}
            >
              <IconComponent size={metrics.iconSize} color={iconColor ?? color} weight="bold" />
            </Pressable>
            <View style={styles.selectedMapPointExtension}>
              <Text numberOfLines={1} style={styles.selectedMapPointLabel}>
                {label}
              </Text>
            </View>
          </View>
        </MarkerView>
      )
    }

    const metrics = navigationActive
      ? MAP_PIN_ICON_METRICS.navigation
      : selected
        ? MAP_PIN_ICON_METRICS.selected
        : MAP_PIN_ICON_METRICS.default
    const annotationKey = getIconAnnotationKey(id, selected, navigationActive, color, iconColor)
    return (
      <PointAnnotation key={annotationKey} id={id} coordinate={coordinate} onSelected={onSelected}>
        {/* collapsable={false}: on iOS New Arch (Fabric) a layout-only wrapper is
            flattened, hoisting its children as direct PointAnnotation subviews and
            triggering "supports max 1 subview" + a broken snapshot (rnmapbox #3682,
            fixed in 10.3.2). Remove once we bump past 10.3.1. */}
        <View collapsable={false} style={styles.iconPinFrame}>
          <View
            style={[
              styles.iconPin,
              iconPinStyle(metrics, color),
              selected && styles.iconPinSelected,
            ]}
          >
            <IconComponent size={metrics.iconSize} color={iconColor ?? color} weight="bold" />
          </View>
        </View>
      </PointAnnotation>
    )
  }

  return (
    <PointAnnotation id={id} coordinate={coordinate} onSelected={onSelected}>
      {/* collapsable={false}: see icon branch above (rnmapbox #3682). */}
      <View collapsable={false} style={[styles.pin, { borderColor: color }]}>
        <View style={[styles.pinCore, { backgroundColor: color }]} />
      </View>
    </PointAnnotation>
  )
}

function getIconAnnotationKey(
  id: string,
  selected: boolean,
  navigationActive: boolean,
  color: string,
  iconColor: string | undefined,
) {
  return `${id}-${navigationActive ? 'navigation' : selected ? 'selected' : 'default'}-${color}-${iconColor ?? color}`
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
    backgroundColor: theme.palette.slate.textPrimary,
  },
  iconPin: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.6),
    shadowColor: theme.palette.slate.surfaceDeep,
    shadowOpacity: 0.22,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  iconPinFrame: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPinSelected: {
    backgroundColor: theme.palette.slate.surfaceDeep,
    shadowOpacity: 0.36,
    shadowRadius: 5,
    elevation: 6,
    zIndex: 2,
  },
  iconPinExpanded: {
    shadowRadius: 7,
    elevation: 8,
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
    backgroundColor: theme.palette.slate.surfaceDeep,
    zIndex: 1,
  },
  selectedMapPointLabel: {
    flexShrink: 1,
    color: theme.palette.slate.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  pinCore: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
  },
})
