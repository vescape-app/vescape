import {
  ArrowsClockwiseIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  PencilSimpleIcon,
  TrashIcon,
} from 'phosphor-react-native'
import { StyleSheet, View } from 'react-native'

import { IconButton } from '@/components/base/IconButton'
import { theme } from '@/constants/theme'
import { Text } from '@/components/base/Text'
import {
  PillSelector,
  PillSelectorAdd,
  PillSelectorItem,
  PillSelectorMenuItem,
} from '@/components/controls/PillSelector'
import { HeaderBackButton } from '@/components/base/HeaderBackButton'
import {
  tuneProfileColorTheme,
  tuneProfileIconComponent,
} from '@/modules/tune/components/TuneProfileMetadataModal'
import type { useTuneModals } from '@/modules/tune/hooks/useTuneModals'
import type { useTuneScreenData } from '@/modules/tune/hooks/useTuneScreenData'

type TuneScreenData = ReturnType<typeof useTuneScreenData>

/** Profile pills, plus history and re-read actions. Rendered as the navigator's own header. */
export function TuneScreenHeader({
  paddingTop,
  profiles,
  activeProfile,
  boardConnected,
  boardSnapshotStatus,
  firmwareCommandsTrusted,
  modals,
  onSelectProfile,
  onOpenHistory,
  onReadBoard,
}: {
  paddingTop: number
  profiles: TuneScreenData['profiles']
  activeProfile: TuneScreenData['activeProfile']
  boardConnected: TuneScreenData['boardConnected']
  boardSnapshotStatus: TuneScreenData['boardSnapshotStatus']
  firmwareCommandsTrusted: TuneScreenData['firmwareCommandsTrusted']
  modals: ReturnType<typeof useTuneModals>
  onSelectProfile: (profileId: string) => void
  onOpenHistory: () => void
  onReadBoard: () => void
}) {
  return (
    <View style={[styles.header, { paddingTop }]}>
      <HeaderBackButton />
      <View style={styles.headerCenter}>
        {profiles.length > 0 ? (
          <PillSelector
            activeId={activeProfile?.id ?? ''}
            contained
            fitContent
            variant="lightTabs"
            style={styles.headerPills}
            contentContainerStyle={styles.headerPillsContent}
          >
            {profiles.map((profile) => (
              <PillSelectorItem
                key={profile.id}
                id={profile.id}
                label={profile.name}
                icon={tuneProfileIconComponent(profile.icon)}
                color={tuneProfileColorTheme(profile.color)}
                onPress={() => onSelectProfile(profile.id)}
              >
                <PillSelectorMenuItem
                  icon={PencilSimpleIcon}
                  label="Edit"
                  onPress={() => modals.setMetadataModalProfile(profile)}
                />
                {modals.otherBoards.length > 0 ? (
                  <PillSelectorMenuItem
                    icon={CopyIcon}
                    label="Copy to board"
                    onPress={() => modals.setCopySourceProfile(profile)}
                  />
                ) : null}
                {profiles.length > 1 ? (
                  <PillSelectorMenuItem
                    icon={TrashIcon}
                    label="Delete"
                    onPress={() => modals.setDeleteConfirmProfile(profile)}
                    danger
                    separator
                  />
                ) : null}
              </PillSelectorItem>
            ))}
            <PillSelectorAdd onPress={() => modals.handleCreateProfile(activeProfile?.id)} />
          </PillSelector>
        ) : (
          <Text style={styles.headerTitle}>Tune</Text>
        )}
      </View>
      <View style={styles.headerActions}>
        {activeProfile ? (
          <IconButton icon={ClockCounterClockwiseIcon} onPress={onOpenHistory} />
        ) : null}
        {boardConnected ? (
          <IconButton
            icon={ArrowsClockwiseIcon}
            onPress={onReadBoard}
            loading={boardSnapshotStatus === 'loading'}
            disabled={!firmwareCommandsTrusted}
          />
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingBottom: 0,
    backgroundColor: theme.palette.slate.bg,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerPills: {
    maxWidth: '100%',
  },
  headerPillsContent: {
    minWidth: 0,
    paddingHorizontal: 2,
  },
  headerTitle: {
    color: theme.palette.slate.textPrimary,
    fontSize: 17,
    fontWeight: '900',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
})
