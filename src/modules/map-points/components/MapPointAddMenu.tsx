import { NavigationArrowIcon, PlusIcon, XIcon } from 'phosphor-react-native'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import type { MapPointCategory } from 'vescape-core'

import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { mapSheetStyles } from '@/modules/map-points/components/mapSheetStyles'
import { getMapPointKindIcon } from '@/modules/map-points/constants/mapPointIcons'
import {
  MAP_POINT_CATEGORY_OPTIONS,
  getMapPointKindColor,
  getMapPointKindTextColor,
} from '@/modules/map-points/constants/mapPoints'
import { isCompactMapPointCategory } from '@/modules/map-points/lib/mapPointVisibility'

const compactMapPointOptions = MAP_POINT_CATEGORY_OPTIONS.filter((option) =>
  isCompactMapPointCategory(option.kind),
)
const secondaryMapPointOptions = MAP_POINT_CATEGORY_OPTIONS.filter(
  (option) => !isCompactMapPointCategory(option.kind),
)

/**
 * Places a new Map Point (or a direction target) at the map centre. Collapsed it is one button;
 * open it is the category sheet.
 */
export function MapPointAddMenu({
  bottom,
  sheetBottom,
  open,
  navigationAction,
  onToggle,
  onSelectCategory,
  onSelectNavigationPoint,
}: {
  bottom: number
  sheetBottom: number
  open: boolean
  navigationAction: { color: string; textColor: string }
  onToggle: () => void
  onSelectCategory: (category: MapPointCategory) => void
  onSelectNavigationPoint: () => void
}) {
  const accents = useResolvedAccentColors()
  const neutral = useResolvedNeutralColors()

  if (!open) {
    return (
      <View style={[styles.mapAddAction, { bottom }]}>
        <Animated.View>
          <IconButton icon={PlusIcon} size="lg" onPress={onToggle} />
        </Animated.View>
      </View>
    )
  }

  return (
    <View
      style={[
        styles.mapAddSheet,
        {
          bottom: sheetBottom,
          backgroundColor: neutral.surface,
          borderColor: neutral.border,
        },
      ]}
    >
      <View style={styles.mapAddSheetHeader}>
        <View
          style={[
            mapSheetStyles.mapTargetIcon,
            { backgroundColor: neutral.surfaceDeep, borderColor: accents.cyan.color },
          ]}
        >
          <PlusIcon size={18} color={accents.cyan.text} weight="bold" />
        </View>
        <View style={mapSheetStyles.mapTargetTitleBlock}>
          <Text style={mapSheetStyles.mapTargetTitle} numberOfLines={1}>
            Add map feature
          </Text>
          <Text style={mapSheetStyles.mapTargetSubtitle} numberOfLines={1}>
            Places at the map center
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close add map feature"
          onPress={onToggle}
          style={({ pressed }) => [
            styles.mapAddCloseButton,
            pressed && mapSheetStyles.mapTargetClosePressed,
          ]}
        >
          <XIcon size={20} color={theme.neutral.textSecondary} weight="bold" />
        </Pressable>
      </View>
      <View style={styles.mapAddButtonGrid}>
        <View style={styles.mapAddCompactRow}>
          {compactMapPointOptions.map((option) => {
            const IconComponent = getMapPointKindIcon(option.kind)
            const color = getMapPointKindColor(option.kind, accents)
            const textColor = getMapPointKindTextColor(option.kind, accents)
            return (
              <Pressable
                key={option.kind}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                style={({ pressed }) => [
                  styles.mapAddFeatureButton,
                  {
                    backgroundColor: theme.alpha(color, 0.12),
                    borderColor: theme.alpha(color, 0.6),
                  },
                  styles.mapAddFeatureButtonHorizontal,
                  styles.mapAddFeatureButtonCompact,
                  pressed && mapSheetStyles.mapAddRowPressed,
                ]}
                onPress={() => onSelectCategory(option.kind)}
              >
                <IconComponent size={16} color={textColor} weight="duotone" />
                <Text style={[styles.mapAddFeatureLabel, { color: textColor }]} numberOfLines={1}>
                  {option.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
        <View style={styles.mapAddSecondaryRow}>
          {secondaryMapPointOptions.map((option) => {
            const IconComponent = getMapPointKindIcon(option.kind)
            const color = getMapPointKindColor(option.kind, accents)
            const textColor = getMapPointKindTextColor(option.kind, accents)
            return (
              <Pressable
                key={option.kind}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                style={({ pressed }) => [
                  styles.mapAddFeatureButton,
                  {
                    backgroundColor: theme.alpha(color, 0.12),
                    borderColor: theme.alpha(color, 0.6),
                  },
                  styles.mapAddFeatureButtonHorizontal,
                  styles.mapAddFeatureButtonSecondary,
                  pressed && mapSheetStyles.mapAddRowPressed,
                ]}
                onPress={() => onSelectCategory(option.kind)}
              >
                <IconComponent size={16} color={textColor} weight="duotone" />
                <Text style={[styles.mapAddFeatureLabel, { color: textColor }]} numberOfLines={1}>
                  {option.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
        <View style={styles.mapAddStackedButtons}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Navigate to map center"
            onPress={() => onSelectNavigationPoint()}
            style={({ pressed }) => [
              styles.mapTargetNavigate,
              {
                backgroundColor: theme.alpha(theme.control.background, 0.85),
                borderColor: navigationAction.color,
              },
              pressed && mapSheetStyles.mapTargetNavigatePressed,
            ]}
          >
            <NavigationArrowIcon size={18} color={navigationAction.color} weight="bold" />
            <Text style={[mapSheetStyles.mapTargetNavigateText, { color: theme.control.text }]}>
              Navigate
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  mapAddAction: {
    position: 'absolute',
    right: 12,
    zIndex: 31,
    alignItems: 'flex-end',
    gap: 0,
  },
  mapAddButtonGrid: {
    gap: 8,
  },
  mapAddCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapAddCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapAddFeatureButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    backgroundColor: theme.alpha(theme.palette.slate.light, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mapAddFeatureButtonCompact: {
    flex: 1,
    minWidth: 0,
    height: 46,
    paddingHorizontal: 6,
  },
  mapAddFeatureButtonHorizontal: {
    flexDirection: 'row',
  },
  mapAddFeatureButtonSecondary: {
    flex: 1,
    minWidth: 0,
    height: 46,
    paddingHorizontal: 8,
  },
  mapAddFeatureLabel: {
    maxWidth: '100%',
    color: theme.neutral.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  mapAddSecondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapAddSheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 45,
    gap: 12,
    padding: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.85),
  },
  mapAddSheetHeader: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  mapAddStackedButtons: {
    gap: 8,
  },
  mapTargetNavigate: {
    height: 46,
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: theme.palette.green.bg,
    borderWidth: 1,
    borderColor: theme.palette.green.border,
  },
})
