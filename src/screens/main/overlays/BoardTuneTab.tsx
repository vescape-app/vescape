import { useEffect } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import {
  CaretRightIcon,
  CheckCircleIcon,
  FootprintsIcon,
  SlidersHorizontalIcon,
} from 'phosphor-react-native'
import { router } from 'expo-router'

import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { Text } from '@/components/base/Text'
import {
  useResolvedSecondaryWidgetPressed,
  useResolvedSecondaryWidgetSurface,
} from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'
import { usePosiSensor } from '@/modules/board/store/boardConfigValuesStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import {
  tuneProfileColorTheme,
  tuneProfileIconComponent,
} from '@/modules/tune/components/TuneProfileMetadataModal'
import { useTuneProfileStore } from '@/modules/tune/store/tuneProfileStore'
import type { TuneProfile } from 'vescape-core'
import { routes } from '@/navigation/routes'

/**
 * Tune, as its own view: the profile in use, every profile for this board one tap away, and the way
 * into the full Tune screen. Picking a profile opens Tune on it, where its values are applied.
 */
export function BoardTuneTab({ onNavigate }: { onNavigate: () => void }) {
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
  const posiSensor = usePosiSensor()
  const surface = useResolvedSecondaryWidgetSurface()

  const profilesLoadedForBoard =
    activeBoardId != null &&
    profileBoardId === activeBoardId &&
    profileCompatibility === tuneCompatibility
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

  useEffect(() => {
    // intentional-suppression: tune profile store error is rendered by the Tune screen
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

  const openButton = (
    <Button
      label="Open Tune"
      variant="tune"
      size="lg"
      icon={SlidersHorizontalIcon}
      onPress={openTune}
      disabled={activeBoardId == null}
      testID="board-drawer-open-tune"
    />
  )

  if (activeBoardId == null) {
    return (
      <View style={styles.content}>
        <Placeholder
          icon={SlidersHorizontalIcon}
          title="No board"
          description="Add a board to pick how it should feel"
          style={styles.placeholder}
        />
        {openButton}
      </View>
    )
  }

  return (
    <View style={styles.content}>
      <ActiveProfileHero
        profile={activeProfileForBoard}
        loading={!profilesLoadedForBoard || profileLoading}
      />

      {posiSensor ? (
        <View style={[surface, styles.sensorRow]}>
          <FootprintsIcon size={18} color={theme.palette.green.color} weight="duotone" />
          <Text style={styles.sensorText}>Both footpad sensors act as one (Posi)</Text>
        </View>
      ) : null}

      {profilesForBoard.length > 0 ? (
        <View style={styles.profileList}>
          <Text style={styles.sectionLabel}>Profiles</Text>
          {profilesForBoard.map((profile) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              active={profile.id === activeProfileForBoard?.id}
              onPress={() => openProfile(profile.id)}
            />
          ))}
        </View>
      ) : profilesLoadedForBoard && !profileLoading ? (
        <Placeholder
          icon={SlidersHorizontalIcon}
          title="No profiles yet"
          description="Open Tune to save how this board feels as a profile"
          style={styles.placeholder}
        />
      ) : null}

      {openButton}
    </View>
  )
}

function ActiveProfileHero({
  profile,
  loading,
}: {
  profile: TuneProfile | null
  loading: boolean
}) {
  const surface = useResolvedSecondaryWidgetSurface()
  const colors = tuneProfileColorTheme(profile?.color ?? 'purple')
  const color = useResolvedColor(colors.color)
  const IconComponent = profile ? tuneProfileIconComponent(profile.icon) : SlidersHorizontalIcon

  return (
    <View style={[surface, styles.hero, { borderColor: theme.alpha(color, 0.4) }]}>
      <View style={[styles.heroIcon, { backgroundColor: theme.alpha(color, 0.12) }]}>
        <IconComponent size={34} color={color} weight="duotone" />
      </View>
      <View style={styles.heroText}>
        <Text style={styles.sectionLabel}>Riding on</Text>
        {loading && !profile ? (
          <ActivityIndicator size="small" color={color} style={styles.heroLoading} />
        ) : (
          <Text style={styles.heroName} numberOfLines={1}>
            {profile?.name ?? 'No profile'}
          </Text>
        )}
        <Text style={styles.heroHint}>Pick how your board should feel.</Text>
      </View>
    </View>
  )
}

function ProfileRow({
  profile,
  active,
  onPress,
}: {
  profile: TuneProfile
  active: boolean
  onPress: () => void
}) {
  const surface = useResolvedSecondaryWidgetSurface()
  const pressedSurface = useResolvedSecondaryWidgetPressed()
  const neutral = useResolvedNeutralColors()
  const color = useResolvedColor(tuneProfileColorTheme(profile.color).color)
  const IconComponent = tuneProfileIconComponent(profile.icon)

  return (
    <Pressable
      style={({ pressed }) => [
        surface,
        styles.profileRow,
        active && { borderColor: theme.alpha(color, 0.6) },
        pressed && pressedSurface,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${profile.name} in Tune`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
    >
      <View style={[styles.profileIcon, { backgroundColor: theme.alpha(color, 0.12) }]}>
        <IconComponent size={20} color={color} weight="duotone" />
      </View>
      <Text style={[styles.profileName, { color: neutral.textPrimary }]} numberOfLines={1}>
        {profile.name}
      </Text>
      {active ? (
        <CheckCircleIcon size={20} color={color} weight="fill" />
      ) : (
        <CaretRightIcon size={16} color={neutral.textMuted} weight="bold" />
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
  },
  placeholder: {
    minHeight: 200,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  heroName: {
    color: theme.neutral.textPrimary,
    fontSize: 22,
    fontWeight: '800',
  },
  heroLoading: {
    alignSelf: 'flex-start',
    marginVertical: 6,
  },
  heroHint: {
    color: theme.neutral.textMuted,
    fontSize: 12,
  },
  sectionLabel: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sensorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sensorText: {
    flex: 1,
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  profileList: {
    gap: 8,
  },
  profileRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  profileIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '700',
  },
})
