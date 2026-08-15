import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native'
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { Text } from '@/components/base/Text'
import {
  FadersIcon,
  FootprintsIcon,
  LightbulbIcon,
  SirenIcon,
  SpeedometerIcon,
  WarningCircleIcon,
  type Icon,
} from 'phosphor-react-native'
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
import { secondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { canRunFirmwareCommand } from '@/modules/board/lib/boardLinkIntegrity'
import { legalPolicyFromReference } from '@/modules/legal/lib/legalMode'
import { routes } from '@/navigation/routes'
import { theme } from '@/constants/theme'
import { errorMessage } from '@/helpers/error'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useLegalModeStore } from '@/modules/legal/store/legalModeStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'
import { useTuneProfileStore } from '@/modules/tune/store/tuneProfileStore'

interface TuneDrawerProps {
  onNavigate: () => void
  onOpenLegalLimits: () => void
}

const PROFILE_OPTION_WIDTH = 46
const PROFILE_ACTIVE_WIDTH = 126
const PROFILE_ANIMATION = { duration: 180 } as const
const AnimatedText = Animated.createAnimatedComponent(Text)

export function TuneDrawer({ onNavigate, onOpenLegalLimits }: TuneDrawerProps) {
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
        label="Tune profiles"
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

      <View style={styles.remoteTiltBox}>
        <RemoteTiltControl collapsible defaultExpanded={false} />
      </View>

      {waitingForTrustedLink ? (
        <Text style={styles.quickDisabledNote}>Quick controls waiting for trusted board link.</Text>
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

      <View style={styles.remoteTiltBox}>
        <BoardMoveControl />
      </View>

      <View style={styles.legalGroup}>
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

interface TuneProfilePillProps {
  label: string
  icon: Icon
  active: boolean
  color: ReturnType<typeof tuneProfileColorTheme>
  onPress: () => void
}

function TuneProfilePill({
  label,
  icon: IconComponent,
  active,
  color,
  onPress,
}: TuneProfilePillProps) {
  const neutral = useResolvedNeutralColors()
  const resolvedBackground = useResolvedColor(color.bg)
  const resolvedBorder = useResolvedColor(color.border)
  const resolvedColor = useResolvedColor(color.color)
  const fadedColor = theme.alpha(resolvedColor, 0.6)
  const activeProgress = useSharedValue(active ? 1 : 0)

  useEffect(() => {
    activeProgress.value = withTiming(active ? 1 : 0, PROFILE_ANIMATION)
  }, [active, activeProgress])

  const frameStyle = useAnimatedStyle(
    () => ({
      width:
        PROFILE_OPTION_WIDTH + (PROFILE_ACTIVE_WIDTH - PROFILE_OPTION_WIDTH) * activeProgress.value,
      backgroundColor: interpolateColor(
        activeProgress.value,
        [0, 1],
        [neutral.surfaceDeep, resolvedBackground],
      ),
      borderColor: interpolateColor(activeProgress.value, [0, 1], [neutral.border, resolvedBorder]),
    }),
    [neutral.border, neutral.surfaceDeep, resolvedBackground, resolvedBorder],
  )
  const labelStyle = useAnimatedStyle(
    () => ({
      opacity: activeProgress.value,
      maxWidth: PROFILE_ACTIVE_WIDTH * activeProgress.value,
      marginLeft: 7 * activeProgress.value,
    }),
    [],
  )

  return (
    <Animated.View style={[styles.profilePill, frameStyle]}>
      <Pressable
        style={({ pressed }) => [styles.profilePillPressable, pressed && styles.profilePillPressed]}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        onPress={onPress}
      >
        <IconComponent size={18} color={active ? resolvedColor : fadedColor} weight="duotone" />
        <AnimatedText
          style={[
            styles.profilePillText,
            { color: active ? resolvedColor : neutral.textMuted },
            labelStyle,
          ]}
          numberOfLines={1}
        >
          {label}
        </AnimatedText>
      </Pressable>
    </Animated.View>
  )
}

interface LegalModeWidgetProps {
  value: boolean
  description: string
  warning: boolean
  onValueChange: (value: boolean) => void
  onWarningPress: () => void
}

function LegalModeWidget({
  value,
  description,
  warning,
  onValueChange,
  onWarningPress,
}: LegalModeWidgetProps) {
  const neutral = useResolvedNeutralColors()
  const errorColor = useResolvedColor(theme.status.error.color)

  return (
    <Pressable
      style={({ pressed }) => [
        styles.legalModeCell,
        styles.legalModeWidget,
        value && styles.legalModeWidgetActive,
        pressed && styles.legalModeWidgetPressed,
      ]}
      accessibilityRole="switch"
      accessibilityLabel="Legal Mode"
      accessibilityState={{ checked: value }}
      onPress={() => onValueChange(!value)}
    >
      <SirenIcon size={22} color={theme.status.error.color} weight="duotone" />
      <View style={styles.legalModeText}>
        <View style={styles.legalModeTitleRow}>
          <Text style={styles.legalModeLabel} numberOfLines={1}>
            Legal mode
          </Text>
          {warning ? (
            <Pressable
              style={styles.legalWarningButton}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Legal road status warning"
              onPress={(event) => {
                event.stopPropagation()
                onWarningPress()
              }}
            >
              <WarningCircleIcon size={15} color={theme.status.error.color} weight="fill" />
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.legalModeDescription} numberOfLines={1}>
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{
          false: neutral.border,
          true: theme.alpha(errorColor, 0.6),
        }}
        thumbColor={value ? errorColor : neutral.textMuted}
        ios_backgroundColor={neutral.border}
        accessibilityLabel="Legal Mode"
      />
    </Pressable>
  )
}

function LegalMapWidget({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.legalMapWidget, pressed && styles.legalMapWidgetPressed]}
      accessibilityRole="button"
      accessibilityLabel="Legal limits map"
      onPress={onPress}
    >
      <SpeedometerIcon size={24} color={theme.palette.green.color} weight="duotone" />
      <View style={styles.legalMapText}>
        <Text style={styles.legalMapLabel} numberOfLines={1}>
          Map
        </Text>
        <Text style={styles.legalMapDescription} numberOfLines={1}>
          limits
        </Text>
      </View>
    </Pressable>
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
  profilePill: {
    width: PROFILE_OPTION_WIDTH,
    height: PROFILE_OPTION_WIDTH,
    borderRadius: PROFILE_OPTION_WIDTH / 2,
    borderWidth: 1,
    overflow: 'hidden',
  },
  profilePillPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  profilePillPressed: {
    backgroundColor: theme.neutral.surface,
  },
  profilePillText: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  remoteTiltBox: {
    ...secondaryWidgetSurface,
    padding: 14,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  quickDisabledNote: {
    color: theme.neutral.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  quickCell: {
    width: '48%',
    flexGrow: 1,
  },
  wideCell: {
    width: '100%',
  },
  legalGroup: {
    ...secondaryWidgetSurface,
    width: '100%',
    overflow: 'hidden',
  },
  legalRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  legalModeCell: {
    flex: 3,
    flexBasis: 0,
    minWidth: 0,
  },
  legalMapCell: {
    width: 82,
  },
  legalRowDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: theme.neutral.border,
  },
  legalModeWidget: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  legalModeWidgetActive: {
    borderWidth: 1,
    borderColor: theme.status.error.border,
  },
  legalModeWidgetPressed: {
    backgroundColor: theme.neutral.surface,
  },
  legalModeText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  legalModeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legalModeLabel: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  legalModeDescription: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  legalMapWidget: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 10,
  },
  legalMapWidgetPressed: {
    backgroundColor: theme.neutral.surface,
  },
  legalMapText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  legalMapLabel: {
    color: theme.neutral.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  legalMapDescription: {
    color: theme.neutral.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  legalWarningButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.neutral.surfaceDeep,
    borderWidth: 1,
    borderColor: theme.status.error.border,
  },
})
