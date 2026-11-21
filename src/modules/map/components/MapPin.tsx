import type { ThemeColor } from '@/constants/theme'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { PointAnnotation } from '@rnmapbox/maps'
import { InMapMarker } from '@/components/map/InMapMarker'
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
  expanded: {
    size: 42,
    radius: 21,
    borderWidth: 2.5,
    iconSize: 22,
    opacity: 1,
  },
} as const

const NAVIGATION_ICON_SIZE = 36
const NAVIGATION_ICON_TIP_INSET = NAVIGATION_ICON_SIZE / 16

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
        <InMapMarker coordinate={coordinate}>
          <View style={styles.selectedMapPoint}>
            <Pressable
              style={[
                styles.iconPin,
                iconPinStyle(metrics, resolvedColor),
                styles.iconPinExpanded,
                { backgroundColor: neutral.surface },
              ]}
              onPress={onSelected}
            >
              <IconComponent size={metrics.iconSize} color={resolvedIconColor} weight="bold" />
            </Pressable>
            <View style={[styles.selectedMapPointExtension, { backgroundColor: neutral.surface }]}>
              <Text
                numberOfLines={1}
                style={[styles.selectedMapPointLabel, { color: neutral.textPrimary }]}
              >
                {label}
              </Text>
            </View>
          </View>
        </InMapMarker>
      )
    }

    if (navigationActive) {
      return (
        <InMapMarker coordinate={coordinate}>
          <View style={styles.navigationPinFrame} pointerEvents="box-none">
            <Pressable onPress={onSelected}>
              <IconComponent
                size={NAVIGATION_ICON_SIZE}
                color={resolvedIconColor}
                weight="regular"
              />
            </Pressable>
          </View>
        </InMapMarker>
      )
    }

    const metrics = selected ? MAP_PIN_ICON_METRICS.selected : MAP_PIN_ICON_METRICS.default
    const pin = (
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
    )
    const annotationKey = getIconAnnotationKey(
      id,
      selected,
      resolvedColor,
      resolvedIconColor,
      neutral.surface,
    )
    return (
      <PointAnnotation key={annotationKey} id={id} coordinate={coordinate} onSelected={onSelected}>
        <View collapsable={false} style={styles.iconPinFrame}>
          {pin}
        </View>
      </PointAnnotation>
    )
  }

  return (
    <PointAnnotation
      key={`${id}-${resolvedColor}-${neutral.surface}`}
      id={id}
      coordinate={coordinate}
      onSelected={onSelected}
    >
      <View
        collapsable={false}
        style={[styles.pin, { backgroundColor: neutral.surface, borderColor: resolvedColor }]}
      >
        <View style={[styles.pinCore, { backgroundColor: resolvedColor }]} />
      </View>
    </PointAnnotation>
  )
}

function getIconAnnotationKey(
  id: string,
  selected: boolean,
  color: string,
  iconColor: string | undefined,
  surfaceColor: string,
) {
  return `${id}-${selected ? 'selected' : 'default'}-${color}-${iconColor ?? color}-${surfaceColor}`
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
  navigationPinFrame: {
    width: NAVIGATION_ICON_SIZE,
    height: (NAVIGATION_ICON_SIZE - NAVIGATION_ICON_TIP_INSET) * 2,
  },
  iconPinSelected: {
    opacity: 1,
    zIndex: 2,
  },
  iconPinExpanded: {},
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
