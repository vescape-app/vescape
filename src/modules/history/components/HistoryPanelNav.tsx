import {
  CaretDownIcon,
  ChartLineIcon,
  CloudArrowUpIcon,
  ImagesSquareIcon,
  StarIcon,
} from 'phosphor-react-native'
import type { RefObject } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { PrevNextSelector } from '@/components/controls/PrevNextSelector'
import { interaction, theme } from '@/constants/theme'
import { HistoryRideLabel } from '@/modules/history/components/HistoryRideLabel'
import { formatRideMeta, formatRideTime } from '@/modules/history/lib/rideFormat'

interface HistoryPanelNavProps {
  titleStartMs: number
  titleEndMs: number
  boardName: string
  title?: string
  subtitle?: string
  canPrevious: boolean
  canNext: boolean
  favoriteMode: boolean
  favorited: boolean
  actionDisabled: boolean
  mediaCount: number
  mediaLoading: boolean
  mediaButtonRef: RefObject<View | null>
  listButtonRef: RefObject<View | null>
  onPrevious: () => void
  onNext: () => void
  onOpenList: () => void
  onOpenMediaDrawer: () => void
  onToggleFavorite: () => void
  onOpenShareInfo: () => void
  /** Ride mode only: the full-screen charts page. A Favorite is about its route and media. */
  onOpenCharts: () => void
}

export function HistoryPanelNav({
  titleStartMs,
  titleEndMs,
  boardName,
  title,
  subtitle,
  canPrevious,
  canNext,
  favoriteMode,
  favorited,
  actionDisabled,
  mediaCount,
  mediaLoading,
  mediaButtonRef,
  listButtonRef,
  onPrevious,
  onNext,
  onOpenList,
  onOpenMediaDrawer,
  onToggleFavorite,
  onOpenShareInfo,
  onOpenCharts,
}: HistoryPanelNavProps) {
  const primaryLabel = title ?? formatRideTime(titleStartMs, titleEndMs)
  const secondaryLabel = subtitle ?? formatRideMeta(titleStartMs, titleEndMs, boardName)

  return (
    <View style={styles.navControls}>
      <View ref={mediaButtonRef} style={styles.navSide}>
        {favoriteMode ? (
          <>
            <IconButton
              icon={ImagesSquareIcon}
              onPress={onOpenMediaDrawer}
              loading={mediaLoading}
              size="lg"
              style={mediaCount > 0 ? styles.mediaEnabled : undefined}
              accessibilityLabel="Favorite media"
            />
            {mediaCount > 0 ? (
              <View style={styles.mediaCountBadge} pointerEvents="none">
                <Text style={styles.mediaCountText}>{mediaCount > 99 ? '99+' : mediaCount}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <IconButton
            icon={ChartLineIcon}
            onPress={onOpenCharts}
            size="lg"
            testID="history-open-charts"
            accessibilityLabel="Full screen charts"
          />
        )}
      </View>
      <PrevNextSelector
        label={primaryLabel}
        previousDisabled={!canPrevious}
        nextDisabled={!canNext}
        onPrevious={onPrevious}
        onNext={onNext}
        previousTestID="history-previous-ride"
        nextTestID="history-next-ride"
        style={styles.navSelector}
        selectControl={
          <Pressable
            ref={listButtonRef}
            collapsable={false}
            testID="history-ride-list-button"
            style={({ pressed }) => [styles.titleButton, pressed && styles.titleButtonPressed]}
            android_ripple={interaction.ripple}
            onPress={onOpenList}
          >
            <HistoryRideLabel
              title={primaryLabel}
              subtitle={secondaryLabel}
              compact
              tone="control"
            />
            <CaretDownIcon size={12} color={theme.control.textMuted} weight="bold" />
          </Pressable>
        }
      />
      <View style={styles.navSide}>
        {favoriteMode ? (
          <IconButton
            icon={CloudArrowUpIcon}
            onPress={onOpenShareInfo}
            size="lg"
            testID="history-share-favorite"
            disabled={actionDisabled}
            accessibilityLabel="Share Favorite"
          />
        ) : (
          <IconButton
            icon={StarIcon}
            onPress={onToggleFavorite}
            size="lg"
            testID="history-favorite-ride"
            accent={favorited ? theme.palette.amber.color : undefined}
            disabled={actionDisabled}
            accessibilityLabel={favorited ? 'Edit Favorite' : 'Create Favorite'}
          />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  navControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'center',
    width: '100%',
    gap: 8,
  },
  navSide: {
    width: 54,
    height: 54,
  },
  navSelector: {
    flex: 1,
    minWidth: 0,
  },
  mediaEnabled: {
    borderColor: theme.palette.purple.border,
    backgroundColor: theme.palette.purple.bg,
  },
  mediaCountBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.palette.purple.border,
    backgroundColor: theme.palette.purple.bg,
  },
  mediaCountText: {
    color: theme.palette.purple.text,
    fontSize: 9,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  titleButtonPressed: {
    opacity: 0.72,
  },
  titleButton: {
    flex: 1,
    minWidth: 0,
    height: 54,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
})
