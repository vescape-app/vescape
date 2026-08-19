import { FunnelIcon } from 'phosphor-react-native'
import { Pressable, StyleSheet, View } from 'react-native'
import type { MapPointCategory } from 'vescape-core'

import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { mapSheetStyles } from '@/modules/map-points/components/mapSheetStyles'
import { getMapPointKindIcon } from '@/modules/map-points/constants/mapPointIcons'
import {
  MAP_POINT_CATEGORY_OPTIONS,
  getMapPointKindColor,
  getMapPointKindTextColor,
} from '@/modules/map-points/constants/mapPoints'

/** Per-category visibility for the Map Points on the map. The direction target is never filtered. */
export function MapPointFilterMenu({
  bottom,
  open,
  hiddenCategories,
  onToggleMenu,
  onToggleCategory,
}: {
  bottom: number
  open: boolean
  hiddenCategories: MapPointCategory[]
  onToggleMenu: () => void
  onToggleCategory: (category: MapPointCategory) => void
}) {
  const neutral = useResolvedNeutralColors()
  return (
    <View style={[styles.mapFilterAction, { bottom }]}>
      {open ? (
        <View style={[styles.mapFilterMenu, styles.mapFilterMenuAttached]}>
          {MAP_POINT_CATEGORY_OPTIONS.map((option, index) => {
            const IconComponent = getMapPointKindIcon(option.kind)
            const color = getMapPointKindColor(option.kind)
            const visible = !hiddenCategories.includes(option.kind)
            return (
              <Pressable
                key={option.kind}
                accessibilityRole="button"
                accessibilityLabel={`${option.label} visibility`}
                accessibilityState={{ checked: visible }}
                style={({ pressed }) => [
                  styles.mapFilterRow,
                  !visible && styles.mapFilterRowHidden,
                  pressed && mapSheetStyles.mapAddRowPressed,
                ]}
                onPress={() => onToggleCategory(option.kind)}
              >
                <View style={[styles.mapAddRowIcon, { borderColor: color }]}>
                  <IconComponent
                    size={16}
                    color={getMapPointKindTextColor(option.kind)}
                    weight="duotone"
                  />
                </View>
                <Text style={styles.mapFilterRowLabel}>{option.label}</Text>
                {index < MAP_POINT_CATEGORY_OPTIONS.length - 1 ? (
                  <View style={styles.mapFilterRowBorder} />
                ) : null}
              </Pressable>
            )
          })}
        </View>
      ) : null}
      <IconButton
        icon={FunnelIcon}
        size="lg"
        iconColor={neutral.textPrimary}
        onPress={onToggleMenu}
        style={
          open
            ? styles.mapFilterButtonAttached
            : { backgroundColor: neutral.surfaceDeep, borderColor: neutral.border }
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  mapAddRowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.neutral.surfaceDeep,
  },
  mapFilterAction: {
    position: 'absolute',
    left: 12,
    zIndex: 31,
    alignItems: 'flex-start',
    gap: 0,
  },
  mapFilterMenu: {
    minWidth: 178,
    alignItems: 'stretch',
    borderRadius: 21,
    overflow: 'hidden',
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.85),
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
  },
  mapFilterMenuAttached: {
    borderBottomLeftRadius: 5,
  },
  mapFilterRow: {
    height: 42,
    paddingLeft: 5,
    paddingRight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 12,
  },
  mapFilterRowBorder: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: theme.alpha(theme.palette.slate.light, 0.3),
  },
  mapFilterRowHidden: {
    opacity: 0.38,
  },
  mapFilterRowLabel: {
    color: theme.neutral.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  mapFilterButtonAttached: {
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.85),
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    borderBottomLeftRadius: 27,
    borderBottomRightRadius: 27,
  },
})
