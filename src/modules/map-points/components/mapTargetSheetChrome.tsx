import { MapPinIcon, ThumbsDownIcon, ThumbsUpIcon, XIcon, type Icon } from 'phosphor-react-native'
import { createElement, type ReactNode } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import type { MapPoint } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { MapPointMediaPreview } from '@/modules/map-points/components/MapPointMediaPreview'
import { mapSheetStyles } from '@/modules/map-points/components/mapSheetStyles'
import {
  getMapPointKindIcon,
  getPlaceCategoryIcon,
} from '@/modules/map-points/constants/mapPointIcons'
import {
  getMapPointKindColor,
  getMapPointKindLabel,
  getMapPointKindTextColor,
  MAP_POINT_MEDIA_ENABLED,
} from '@/modules/map-points/constants/mapPoints'
import type { MapPointMediaAsset } from '@/modules/map-points/store/mapPointPhotoFiles'
import type { MapSelection } from '@/modules/map/lib/mapSelection'

export interface MapTargetSheetAction {
  label: string
  accessibilityLabel: string
  color: string
  textColor: string
  borderColor: string
  bgColor: string
  Icon: Icon
  onPress: () => void
}

export function MapTargetSheetFrame({
  target,
  bottom,
  header,
  fallbackColor = theme.map.target,
  fallbackTextColor = theme.palette.slate.textPrimary,
  onDismiss,
  onFocusTarget,
  children,
}: {
  target: MapSelection
  bottom: number
  header: ReactNode
  fallbackColor?: string
  fallbackTextColor?: string
  onDismiss?: () => void
  onFocusTarget?: () => void
  children: ReactNode
}) {
  const isMapPoint = target.type === 'mapPoint'
  const color = isMapPoint ? getMapPointKindColor(target.point.category) : fallbackColor
  const textColor = isMapPoint ? getMapPointKindTextColor(target.point.category) : fallbackTextColor
  const IconComponent = isMapPoint
    ? getMapPointKindIcon(target.point.category)
    : target.type === 'place'
      ? getPlaceCategoryIcon(target.category)
      : MapPinIcon
  const icon = createElement(IconComponent, { size: 18, color: textColor, weight: 'duotone' })
  const headerContent = (
    <>
      <View style={[mapSheetStyles.mapTargetIcon, { borderColor: color }]}>{icon}</View>
      <View style={mapSheetStyles.mapTargetTitleBlock}>{header}</View>
    </>
  )

  return (
    <View style={[styles.sheet, { bottom }]}>
      <View style={styles.header}>
        {onFocusTarget ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Center map on target"
            onPress={onFocusTarget}
            style={({ pressed }) => [styles.focusArea, pressed && styles.focusAreaPressed]}
          >
            {headerContent}
          </Pressable>
        ) : (
          <View style={styles.focusArea}>{headerContent}</View>
        )}
        {onDismiss ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close target"
            onPress={onDismiss}
            style={({ pressed }) => [styles.close, pressed && mapSheetStyles.mapTargetClosePressed]}
          >
            <XIcon size={20} color={theme.palette.slate.textSecondary} weight="bold" />
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  )
}

export function MapTargetReadHeader({ target }: { target: MapSelection }) {
  if (target.type === 'mapPoint') {
    const title = target.point.name?.trim() || getMapPointKindLabel(target.point.category)
    const created = new Date(target.point.createdAt).toLocaleDateString()
    return (
      <>
        <Text style={mapSheetStyles.mapTargetTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.metaText} numberOfLines={1}>
          Vescape rider · {created}
        </Text>
      </>
    )
  }

  const detail = target.loadingDetails
    ? 'Loading details'
    : target.subtitle || `${target.latitude.toFixed(5)}, ${target.longitude.toFixed(5)}`

  return (
    <>
      <Text style={mapSheetStyles.mapTargetTitle} numberOfLines={1}>
        {target.title}
      </Text>
      <Text style={mapSheetStyles.mapTargetSubtitle} numberOfLines={2}>
        {detail}
      </Text>
    </>
  )
}

export function MapTargetEditHeader({
  point,
  name,
  onChangeName,
}: {
  point: MapPoint
  name: string
  onChangeName: (name: string) => void
}) {
  return (
    <TextInput
      value={name}
      onChangeText={onChangeName}
      placeholder={getMapPointKindLabel(point.category)}
      placeholderTextColor={theme.palette.slate.textMuted}
      style={[styles.input, styles.nameInput]}
      accessibilityLabel="Map feature name"
    />
  )
}

export function MapPointDetails({
  point,
  media,
}: {
  point: MapPoint
  media: readonly MapPointMediaAsset[]
}) {
  const description = point.description?.trim()
  return (
    <>
      {description ? (
        <View style={styles.descriptionBlock}>
          <Text style={mapSheetStyles.mapTargetSubtitle}>{description}</Text>
        </View>
      ) : null}
      {MAP_POINT_MEDIA_ENABLED && media.length > 0 ? (
        <View style={styles.mediaBox}>
          <MapPointMediaPreview assets={media} />
        </View>
      ) : null}
      <View style={styles.voteCount}>
        {point.score < 0 ? (
          <ThumbsDownIcon size={14} color={theme.status.error.text} weight="fill" />
        ) : (
          <ThumbsUpIcon size={14} color={theme.palette.cyan.text} weight="fill" />
        )}
        <Text style={styles.metaText}>{point.score}</Text>
      </View>
    </>
  )
}

export function MapTargetActionRow({ children }: { children: ReactNode }) {
  return <View style={styles.actionRow}>{children}</View>
}

/**
 * A sheet action button. `compact` is the same button at side-action weight, giving the row's width
 * to the action the rider is most likely to want; `iconOnly` drops to the icon alone, for actions
 * whose icon is unambiguous and whose label would otherwise crowd the one that matters. The label
 * still exists — it stays the accessibility name.
 */
export function MapTargetPrimaryAction({
  action,
  compact = false,
  iconOnly = false,
}: {
  action: MapTargetSheetAction
  compact?: boolean
  iconOnly?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel}
      onPress={action.onPress}
      style={({ pressed }) => [
        styles.actionButton,
        compact ? styles.actionButtonCompact : styles.actionButtonLead,
        iconOnly && styles.actionButtonIconOnly,
        { backgroundColor: action.bgColor, borderColor: action.borderColor },
        pressed && mapSheetStyles.mapTargetNavigatePressed,
      ]}
    >
      <action.Icon size={compact ? 18 : 18} color={action.textColor} weight="bold" />
      {iconOnly ? null : (
        <Text
          style={[
            mapSheetStyles.mapTargetNavigateText,
            compact && styles.actionLabelCompact,
            { color: action.textColor },
          ]}
        >
          {action.label}
        </Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  actionButton: {
    minWidth: 0,
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
  actionButtonLead: {
    flex: 2,
  },
  actionButtonCompact: {
    flex: 1,
    height: 42,
    gap: 6,
  },
  /** A square button: it holds an icon, so it must not stretch with the row it sits in. */
  actionButtonIconOnly: {
    flex: 0,
    width: 42,
    height: 42,
    borderRadius: 21,
    gap: 0,
  },
  actionLabelCompact: {
    fontSize: 12,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  descriptionBlock: {
    paddingRight: 36,
  },
  focusArea: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
  },
  focusAreaPressed: {
    opacity: 0.65,
  },
  header: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  input: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    backgroundColor: theme.alpha(theme.palette.slate.bg, 0.75),
    paddingHorizontal: 12,
    color: theme.palette.slate.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  mediaBox: {
    gap: 12,
  },
  metaText: {
    color: theme.palette.slate.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  nameInput: {
    minHeight: 38,
    paddingHorizontal: 10,
    fontSize: 15,
    fontWeight: '900',
  },
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 45,
    gap: 12,
    padding: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
  },
  voteCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
})

export const mapTargetSheetChromeStyles = styles
