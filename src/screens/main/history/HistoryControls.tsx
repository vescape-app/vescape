import { StyleSheet, View } from 'react-native'
import {
  ArrowLeftIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  PencilSimpleIcon,
  StarIcon,
  TrashIcon,
  XIcon,
} from 'phosphor-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { IconButton } from '@/components/base/IconButton'
import { PillSelector, PillSelectorItem } from '@/components/controls/PillSelector'
import { Input } from '@/components/forms/Input'
import { theme } from '@/constants/theme'
import type { HistoryTab } from '@/screens/main/mainScreenStore'

interface HistoryControlsProps {
  loading: boolean
  tab: HistoryTab
  canRemove: boolean
  /** Trim mode swaps tabs/star/trash for a cancel/save pair over the range being pinned. */
  trimming: boolean
  /**
   * Favorite tab actions. Selection stays in the shared history panel below.
   */
  favorite?: {
    onEdit: () => void
    onDelete: () => void
  }
  saving: boolean
  trimName: string
  trimNamePlaceholder?: string
  onTrimNameChange: (name: string) => void
  onSelectTab: (tab: HistoryTab) => void
  onBack: () => void
  onRemove: () => void
  onCancelTrim: () => void
  onSaveTrim: () => void
}

export function HistoryControls({
  loading,
  tab,
  canRemove,
  trimming,
  favorite,
  saving,
  trimName,
  trimNamePlaceholder = 'Favorite name',
  onTrimNameChange,
  onSelectTab,
  onBack,
  onRemove,
  onCancelTrim,
  onSaveTrim,
}: HistoryControlsProps) {
  const insets = useSafeAreaInsets()

  if (trimming) {
    return (
      <View style={[styles.wrap, { paddingTop: Math.max(insets.top, 8) }]} pointerEvents="box-none">
        <View style={styles.row}>
          <IconButton
            icon={XIcon}
            onPress={onCancelTrim}
            disabled={saving}
            testID="trim-cancel"
            accessibilityLabel="Cancel Favorite edit"
          />
          <View style={styles.headerTitleWrap}>
            <Input
              testID="trim-favorite-name"
              value={trimName}
              onChangeText={onTrimNameChange}
              placeholder={trimNamePlaceholder}
              editable={!saving}
              returnKeyType="done"
              onSubmitEditing={onSaveTrim}
              style={styles.nameInput}
            />
          </View>
          <IconButton
            icon={CheckIcon}
            onPress={onSaveTrim}
            loading={saving}
            testID="trim-save"
            accent={theme.palette.amber.color}
            accessibilityLabel="Save Favorite"
          />
        </View>
      </View>
    )
  }

  return (
    <View style={[styles.wrap, { paddingTop: Math.max(insets.top, 8) }]} pointerEvents="box-none">
      <View style={styles.row}>
        <IconButton
          icon={ArrowLeftIcon}
          testID="history-back"
          onPress={onBack}
          accessibilityLabel="Back"
        />
        <View style={styles.tabsWrap} pointerEvents="box-none">
          <PillSelector
            activeId={tab}
            contained
            fitContent
            style={styles.tabs}
            contentContainerStyle={styles.tabsContent}
          >
            <PillSelectorItem
              id="history"
              label="History"
              icon={ClockCounterClockwiseIcon}
              activeLabelOnly
              activeWidth={116}
              inactiveWidth={46}
              color={theme.palette.sky}
              testID="history-tab-history"
              onPress={() => onSelectTab('history')}
            />
            <PillSelectorItem
              id="favorites"
              label="Favorites"
              icon={StarIcon}
              activeLabelOnly
              activeWidth={126}
              inactiveWidth={46}
              color={theme.palette.amber}
              testID="history-tab-favorites"
              onPress={() => onSelectTab('favorites')}
            />
          </PillSelector>
        </View>
        <View style={styles.actions}>
          {favorite ? (
            <>
              <IconButton
                icon={PencilSimpleIcon}
                onPress={favorite.onEdit}
                disabled={loading}
                testID="favorite-edit"
                accessibilityLabel="Edit Favorite"
              />
              <IconButton
                icon={TrashIcon}
                onPress={favorite.onDelete}
                destructive
                disabled={loading}
                testID="favorite-delete"
                accessibilityLabel="Delete Favorite"
              />
            </>
          ) : null}
          {!favorite && canRemove ? (
            <IconButton
              icon={TrashIcon}
              onPress={onRemove}
              destructive
              disabled={loading}
              accessibilityLabel="Delete ride"
            />
          ) : !favorite ? (
            <View style={styles.actionSpacer} />
          ) : null}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  actionSpacer: {
    width: 38,
    height: 38,
  },
  wrap: {
    position: 'absolute',
    top: 0,
    left: 10,
    right: 10,
    zIndex: 30,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  tabsWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  actions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 1,
  },
  tabs: {
    alignSelf: 'center',
  },
  tabsContent: {
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  nameInput: {
    width: '100%',
    height: 38,
    paddingVertical: 0,
    textAlign: 'center',
  },
})
