import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { router } from 'expo-router'

import { BoardLightsControl } from '@/modules/board/components/BoardLightsControl'
import { BoardMoveControl } from '@/modules/board/components/BoardMoveControl'
import { RemoteTiltControl } from '@/modules/board/components/RemoteTiltControl'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { InfoModal } from '@/components/modals/InfoModal'
import {
  tuneProfileColorTheme,
  tuneProfileIconComponent,
} from '@/modules/tune/components/TuneProfileMetadataModal'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { canRunFirmwareCommand } from '@/modules/board/lib/boardLinkIntegrity'
import { useLegalReferenceSpeedFormat } from '@/modules/legal/hooks/useLegalLimitsFormat'
import { legalPolicyFromReference } from '@/modules/legal/lib/legalMode'
import { routes } from '@/navigation/routes'
import { theme } from '@/constants/theme'
import { TuneProfileSelectCard } from '@/modules/tune/components/TuneProfileSelectCard'
import { PillSelector, PillSelectorItem } from '@/components/controls/PillSelector'
import { LegalMapWidget, LegalModeWidget } from '@/screens/main/overlays/TuneDrawerLegalWidgets'
import { errorMessage } from '@/helpers/error'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useLegalModeStore } from '@/modules/legal/store/legalModeStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { isCompatibleProfile } from '@/modules/tune/store/tuneProfileHelpers'
import { tuneCompatibilityVersion } from '@/modules/tune/lib/tuneCompatibility'
import { useTuneProfileStore } from '@/modules/tune/store/tuneProfileStore'

interface TuneDrawerProps {
  onNavigate: () => void
  onOpenLegalLimits: () => void
}

export function BoardDrawer({ onNavigate, onOpenLegalLimits }: TuneDrawerProps) {
  const formatReferenceSpeed = useLegalReferenceSpeedFormat()
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null)
  const [legalWarningOpen, setLegalWarningOpen] = useState(false)
  // The message outlives `visible` on purpose: `FadeCardModal` keeps rendering its children through
  // the exit animation, so clearing it on dismiss would blank the card as it fades.
  const [legalModeError, setLegalModeError] = useState({ message: '', visible: false })
  const activeBoardId = useBoardStore((state) => state.activeBoardId)
  const reportedCompatibility = useBoardStore(
    (state) =>
      state.boards.find((board) => board.id === state.activeBoardId)?.link?.refloatBaseVersion ??
      null,
  )
  const activeProfile = useTuneProfileStore((state) => state.activeProfile)
  const profiles = useTuneProfileStore((state) => state.profiles)
  const profileLoading = useTuneProfileStore((state) => state.loading)
  const profileBoardId = useTuneProfileStore((state) => state.activeBoardId)
  const profileCompatibility = useTuneProfileStore((state) => state.refloatBaseVersion)
  const tuneCompatibility =
    tuneCompatibilityVersion(reportedCompatibility) ??
    (profileBoardId === activeBoardId ? profileCompatibility : null)
  const loadProfiles = useTuneProfileStore((state) => state.loadProfiles)
  const setActiveProfile = useTuneProfileStore((state) => state.setActiveProfile)
  const legalModeEnabled = useBoardStore(
    (state) =>
      state.boards.find((board) => board.id === state.activeBoardId)?.legalMode?.enabled ?? false,
  )
  const legalPolicyReference = useSettingsStore((state) => state.legalPolicy)
  const setLegalModeEnabled = useLegalModeStore((state) => state.setEnabled)
  const legalPolicy = useMemo(
    () => legalPolicyFromReference(legalPolicyReference),
    [legalPolicyReference],
  )
  const showLegalWarning =
    legalPolicy?.status === 'restricted' || legalPolicy?.status === 'notRoadLegal'
  const profilesLoadedForBoard =
    activeBoardId != null &&
    profileBoardId === activeBoardId &&
    profileCompatibility === tuneCompatibility
  const boardConnected = useBleStore((state) => state.status === 'connected')
  const linkIntegrity = useBleStore((state) => state.linkIntegrity)
  const quickControlsEnabled = boardConnected && canRunFirmwareCommand(linkIntegrity)
  const waitingForTrustedLink = boardConnected && !quickControlsEnabled
  const profilesForBoard = profilesLoadedForBoard
    ? profiles.filter(
        (profile) =>
          profile.boardId === activeBoardId && profile.refloatBaseVersion === tuneCompatibility,
      )
    : []
  const activeProfileForBoard =
    profilesLoadedForBoard &&
    activeProfile?.boardId === activeBoardId &&
    activeProfile.refloatBaseVersion === tuneCompatibility
      ? activeProfile
      : null
  const hasProfiles = profilesForBoard.length > 0

  useEffect(() => {
    if (!activeBoardId) return
    const current = useTuneProfileStore.getState()
    // The drawer and editor share a draft. Reopening quick settings must not reload it.
    if (
      current.activeProfile &&
      isCompatibleProfile(current.activeProfile, activeBoardId, tuneCompatibility)
    )
      return
    // intentional-suppression: board config store error is rendered by the drawer
    void loadProfiles(activeBoardId, tuneCompatibility).catch(() => undefined) // Store error renders in this drawer.
  }, [activeBoardId, loadProfiles, tuneCompatibility])

  const openTune = () => {
    onNavigate()
    router.push(routes.tune)
  }

  const openProfile = (profileId: string) => {
    const current = useTuneProfileStore.getState()
    if (current.activeProfile?.id === profileId) return
    if (Object.keys(current.getDirtyFields()).length > 0) {
      setPendingProfileId(profileId)
      return
    }
    setActiveProfile(profileId)
  }

  const toggleLegalMode = (enabled: boolean) => {
    if (!activeBoardId) return
    void setLegalModeEnabled(activeBoardId, enabled).catch((error: unknown) => {
      setLegalModeError({
        message: errorMessage(error, 'Could not change Legal Mode.'),
        visible: true,
      })
    })
  }

  const surface = useResolvedSecondaryWidgetSurface()
  const activeName =
    activeBoardId == null
      ? 'No board'
      : profilesLoadedForBoard
        ? (activeProfileForBoard?.name ?? (profileLoading ? 'Loading...' : 'No profile'))
        : 'Loading...'
  const legalModeDescription = legalPolicy
    ? `${legalPolicy.name} · max ${formatReferenceSpeed(legalPolicy.referenceSpeedKmh)}`
    : 'Jurisdiction unresolved'

  return (
    <View style={styles.content}>
      <TuneProfileSelectCard
        title
        activeProfile={activeProfileForBoard}
        emptyLabel={activeName}
        onEdit={openTune}
      >
        {hasProfiles ? (
          <PillSelector
            size="lg"
            activeId={activeProfileForBoard?.id ?? ''}
            contained
            fitContent
            variant="lightTabs"
            style={styles.profilePills}
          >
            {profilesForBoard.map((profile) => (
              <PillSelectorItem
                key={profile.id}
                id={profile.id}
                label={profile.name}
                icon={tuneProfileIconComponent(profile.icon)}
                color={tuneProfileColorTheme(profile.color)}
                onPress={() => openProfile(profile.id)}
              />
            ))}
          </PillSelector>
        ) : null}
      </TuneProfileSelectCard>

      <BoardLightsControl enabled={quickControlsEnabled} />

      <View style={[surface, styles.remoteTiltBox]}>
        <RemoteTiltControl />
      </View>

      {waitingForTrustedLink ? (
        <Text style={styles.quickDisabledNote}>Quick controls waiting for trusted board link.</Text>
      ) : null}

      <View style={[surface, styles.remoteTiltBox]}>
        <BoardMoveControl />
      </View>

      <View style={[surface, styles.legalGroup]}>
        <View style={styles.legalRow}>
          <LegalModeWidget
            value={legalModeEnabled}
            description={legalModeDescription}
            warning={showLegalWarning}
            onValueChange={toggleLegalMode}
            onWarningPress={() => setLegalWarningOpen(true)}
          />
          <View style={styles.legalRowDivider} />
          <View style={styles.legalMapCell}>
            <LegalMapWidget onPress={onOpenLegalLimits} />
          </View>
        </View>
      </View>

      <ConfirmModal
        visible={pendingProfileId != null}
        title="Discard unsaved tune changes?"
        message="Switching profiles discards your unsaved edits in the app. Nothing is sent to the board."
        confirmLabel="Switch profile"
        onCancel={() => setPendingProfileId(null)}
        onConfirm={() => {
          if (pendingProfileId) setActiveProfile(pendingProfileId)
          setPendingProfileId(null)
        }}
      />
      <InfoModal
        visible={legalWarningOpen}
        title="Legal Road Status"
        message={legalPolicy?.warningText ?? 'This jurisdiction has restricted status.'}
        variant="warning"
        dismissLabel="Close"
        onDismiss={() => setLegalWarningOpen(false)}
      />
      <InfoModal
        visible={legalModeError.visible}
        title="Legal Mode unavailable"
        message={legalModeError.message}
        variant="danger"
        dismissLabel="Close"
        onDismiss={() => setLegalModeError((current) => ({ ...current, visible: false }))}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
  },
  profilePills: {
    marginHorizontal: 0,
  },
  remoteTiltBox: {
    padding: 14,
  },
  quickDisabledNote: {
    color: theme.neutral.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  legalGroup: {
    width: '100%',
    overflow: 'hidden',
  },
  legalRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  legalRowDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: theme.neutral.border,
  },
  legalMapCell: {
    width: 82,
  },
})
