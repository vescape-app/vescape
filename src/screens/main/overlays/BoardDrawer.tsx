import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { FadersIcon, FootprintsIcon, LightbulbIcon } from 'phosphor-react-native'
import { router } from 'expo-router'

import { BoardMoveControl } from '@/modules/board/components/BoardMoveControl'
import { RemoteTiltControl } from '@/modules/board/components/RemoteTiltControl'
import { InfoModal } from '@/components/modals/InfoModal'
import {
  tuneProfileColorTheme,
  tuneProfileIconComponent,
} from '@/modules/tune/components/TuneProfileMetadataModal'
import { SelectWidget } from '@/components/widgets/SelectWidget'
import { SwitchWidget } from '@/components/widgets/SwitchWidget'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { canRunFirmwareCommand } from '@/modules/board/lib/boardLinkIntegrity'
import { legalPolicyFromReference } from '@/modules/legal/lib/legalMode'
import { routes } from '@/navigation/routes'
import { theme } from '@/constants/theme'
import { TuneProfilePill } from '@/screens/main/overlays/TuneProfilePill'
import { LegalMapWidget, LegalModeWidget } from '@/screens/main/overlays/TuneDrawerLegalWidgets'
import { errorMessage } from '@/helpers/error'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useLegalModeStore } from '@/modules/legal/store/legalModeStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { useTuneProfileStore } from '@/modules/tune/store/tuneProfileStore'

interface TuneDrawerProps {
  onNavigate: () => void
  onOpenLegalLimits: () => void
}

export function BoardDrawer({ onNavigate, onOpenLegalLimits }: TuneDrawerProps) {
  const [tuneSelectOpen, setTuneSelectOpen] = useState(false)
  const [legalWarningOpen, setLegalWarningOpen] = useState(false)
  // The label outlives `visible` on purpose: `FadeCardModal` keeps rendering its children through
  // the exit animation, so clearing the name on dismiss would blank the card as it fades.
  const [unbuiltControl, setUnbuiltControl] = useState({ label: '', visible: false })
  // Same reason as `unbuiltControl`: the message has to survive the card's exit animation.
  const [legalModeError, setLegalModeError] = useState({ message: '', visible: false })
  const activeBoardId = useBoardStore((state) => state.activeBoardId)
  const tuneCompatibility = useBoardStore(
    (state) =>
      state.boards.find((board) => board.id === state.activeBoardId)?.link?.refloatBaseVersion ??
      null,
  )
  const activeProfile = useTuneProfileStore((state) => state.activeProfile)
  const profiles = useTuneProfileStore((state) => state.profiles)
  const profileLoading = useTuneProfileStore((state) => state.loading)
  const profileBoardId = useTuneProfileStore((state) => state.activeBoardId)
  const profileCompatibility = useTuneProfileStore((state) => state.refloatBaseVersion)
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
    if (activeBoardId) void loadProfiles(activeBoardId, tuneCompatibility).catch(() => undefined)
  }, [activeBoardId, loadProfiles, tuneCompatibility])

  const openTune = () => {
    onNavigate()
    router.push(routes.tune)
  }

  const openProfile = (profileId: string) => {
    setActiveProfile(profileId)
    openTune()
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
    ? `${legalPolicy.name} · max ${legalPolicy.referenceSpeedKmh ?? 'N/A'} km/h`
    : 'Jurisdiction unresolved'
  const SelectIcon = activeProfileForBoard
    ? tuneProfileIconComponent(activeProfileForBoard.icon)
    : undefined
  const selectTheme = activeProfileForBoard
    ? tuneProfileColorTheme(activeProfileForBoard.color)
    : tuneProfileColorTheme('purple')

  return (
    <View style={styles.content}>
      <SelectWidget
        icon={FadersIcon}
        selectIcon={SelectIcon}
        label="Tune"
        value={activeName}
        description="Pick how your board should feel."
        accent={theme.tune.color}
        selectAccent={selectTheme.color}
        selectBackground={selectTheme.bg}
        selectBorder={selectTheme.border}
        selectOpen={tuneSelectOpen}
        showSelect={hasProfiles}
        onPress={openTune}
        onSelectPress={() => setTuneSelectOpen((open) => !open)}
      />

      {tuneSelectOpen && hasProfiles ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.profilePills}
        >
          {profilesForBoard.map((profile) => {
            const active = profile.id === activeProfileForBoard?.id
            const Icon = tuneProfileIconComponent(profile.icon)
            const color = tuneProfileColorTheme(profile.color)
            return (
              <TuneProfilePill
                key={profile.id}
                label={profile.name}
                icon={Icon}
                active={active}
                color={color}
                onPress={() => openProfile(profile.id)}
              />
            )
          })}
        </ScrollView>
      ) : null}

      <View style={styles.quickGrid}>
        <View style={styles.quickCell}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Lights, not available yet"
            onPress={() => setUnbuiltControl({ label: 'Lights', visible: true })}
          >
            <SwitchWidget
              icon={LightbulbIcon}
              label="Lights"
              size="half"
              value={false}
              onValueChange={() => {}}
              accent={theme.palette.amber.color}
              disabled
            />
          </Pressable>
        </View>
        <View style={styles.quickCell}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Posi, not available yet"
            onPress={() => setUnbuiltControl({ label: 'Posi', visible: true })}
          >
            <SwitchWidget
              icon={FootprintsIcon}
              label="Posi"
              size="half"
              value={false}
              onValueChange={() => {}}
              accent={theme.palette.green.color}
              disabled
            />
          </Pressable>
        </View>
      </View>

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

      <InfoModal
        visible={legalWarningOpen}
        title="Legal Road Status"
        message={legalPolicy?.warningText ?? 'This jurisdiction has restricted status.'}
        variant="warning"
        dismissLabel="Close"
        onDismiss={() => setLegalWarningOpen(false)}
      />
      <InfoModal
        visible={unbuiltControl.visible}
        title={`${unbuiltControl.label} not ready yet`}
        message={`${unbuiltControl.label} is not wired to the board yet — the switch is here so the layout is final. It will start working in a later update.`}
        dismissLabel="Close"
        onDismiss={() => setUnbuiltControl((current) => ({ ...current, visible: false }))}
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
    gap: 8,
    paddingRight: 8,
  },
  remoteTiltBox: {
    padding: 14,
  },
  quickDisabledNote: {
    color: theme.neutral.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  quickCell: {
    width: '48%',
    flexGrow: 1,
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
