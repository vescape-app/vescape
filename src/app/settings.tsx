import { PageScrollView } from '@/components/base/PageScrollView'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { AccessoryIcon } from '@/modules/accessories/constants/accessoryIcon'
import { Fragment, useLayoutEffect, useMemo, useState } from 'react'
import { View, StyleSheet, Platform } from 'react-native'
import { Text } from '@/components/base/Text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useNavigation, type Href } from 'expo-router'
import Constants from 'expo-constants'
import {
  BluetoothConnectedIcon,
  BracketsCurlyIcon,
  CodeIcon,
  DatabaseIcon,
  InfoIcon,
  TagIcon,
  AndroidLogoIcon,
  AppleLogoIcon,
  HouseIcon,
  ClockCounterClockwiseIcon,
  ChartLineUpIcon,
  GaugeIcon,
  NewspaperIcon,
  WatchIcon,
  EngineIcon,
  MapTrifoldIcon,
  SpeakerHighIcon,
  type Icon,
} from 'phosphor-react-native'

import { routes } from '@/navigation/routes'
import { theme, type ThemeColor } from '@/constants/theme'
import { DASH, formatBytes } from '@/helpers/format'
import { speedUnit, temperatureSymbol } from '@/helpers/units'
import { dateFormatLabel } from '@/helpers/time'
import { IconButton } from '@/components/base/IconButton'
import { SearchInput } from '@/components/forms/SearchInput'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { IconHero } from '@/components/settings/IconHero'
import { VescapeWordmark } from '@/components/base/VescapeWordmark'
import { useSettingsDatabaseOps } from '@/modules/settings/hooks/useSettingsDatabaseOps'
import {
  SETTINGS_GROUPS,
  searchSettings,
  type SettingsPlatform,
  type SettingsSectionId,
} from '@/modules/settings/lib/settingsCatalog'
import { ReleaseActionPill } from '@/modules/release/components/ReleaseActionPill'
import { selectAvailableUpdate } from '@/modules/release/lib/availableUpdate'
import { useAppStatusStore } from '@/modules/release/store/appStatusStore'
import { openAppUpdate } from 'vescape-core'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

const appVersion = Constants.expoConfig?.version ?? DASH

const SETTINGS_PLATFORM: SettingsPlatform | undefined =
  Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : undefined

const SECTION_VISUALS: Record<SettingsSectionId, { icon: Icon; color: ThemeColor }> = {
  automation: { icon: BluetoothConnectedIcon, color: theme.settingsIcon.automation },
  liveTelemetry: { icon: GaugeIcon, color: theme.settingsIcon.liveTelemetry },
  diagnostics: { icon: EngineIcon, color: theme.settingsIcon.diagnostics },
  units: { icon: GaugeIcon, color: theme.palette.amber.color },
  map: { icon: MapTrifoldIcon, color: theme.palette.green.color },
  sounds: { icon: SpeakerHighIcon, color: theme.settingsIcon.sounds },
  watch: { icon: WatchIcon, color: theme.settingsIcon.watch },
  accessories: { icon: AccessoryIcon, color: theme.palette.teal.color },
  privacyZones: { icon: HouseIcon, color: theme.settingsIcon.privacyZones },
  history: { icon: ClockCounterClockwiseIcon, color: theme.settingsIcon.filters },
  graphs: { icon: ChartLineUpIcon, color: theme.settingsIcon.graphs },
  dev: { icon: CodeIcon, color: theme.settingsIcon.dev },
  about: { icon: InfoIcon, color: theme.settingsIcon.about },
  database: { icon: DatabaseIcon, color: theme.settingsIcon.database },
  rawSettings: { icon: BracketsCurlyIcon, color: theme.neutral.textSecondary },
  releaseNotes: { icon: NewspaperIcon, color: theme.settingsIcon.update },
}

export default function SettingsScreen() {
  const distanceUnit = useSettingsStore((state) => state.distanceUnit)
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const dateFormat = useSettingsStore((state) => state.dateFormat)
  const temperatureUnit = useSettingsStore((state) => state.temperatureUnit)
  const db = useSettingsDatabaseOps()
  const navigation = useNavigation()
  const appStatus = useAppStatusStore((state) => state.status)
  const availableUpdate = selectAvailableUpdate(appStatus)
  const neutral = useResolvedNeutralColors()
  const [query, setQuery] = useState('')
  const searching = query.trim().length > 0
  const results = useMemo(
    () => (searching ? searchSettings(query, SETTINGS_PLATFORM) : []),
    [query, searching],
  )
  const unitsHint = `${speedUnit(distanceUnit)} · ${temperatureSymbol(temperatureUnit)} · ${timeFormat} · ${dateFormatLabel(dateFormat)}`

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton
          icon={BracketsCurlyIcon}
          onPress={() => router.push(routes.settingsRawSettings)}
          accessibilityLabel="Raw settings"
        />
      ),
    })
  }, [navigation])

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: neutral.bg }]} edges={[]}>
      <PageScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <IconHero media={<VescapeWordmark width={200} />}>
          <View style={styles.headerStats}>
            <View style={styles.headerItem}>
              <TagIcon size={14} color={theme.palette.sky.color} weight="duotone" />
              <Text style={styles.headerValue}>v{appVersion}</Text>
            </View>
            <View style={styles.headerItem}>
              {Platform.OS === 'ios' ? (
                <AppleLogoIcon size={14} color={theme.palette.purple.color} weight="duotone" />
              ) : (
                <AndroidLogoIcon size={14} color={theme.palette.green.color} weight="duotone" />
              )}
              <Text style={styles.headerValue}>
                {Platform.OS === 'ios' ? 'iOS' : 'Android'} {Platform.Version}
              </Text>
            </View>
            <View style={styles.headerItem}>
              <DatabaseIcon size={14} color={theme.status.warning.color} weight="duotone" />
              <Text style={styles.headerValue}>
                {db.dbSize != null ? formatBytes(db.dbSize) : DASH}
              </Text>
            </View>
          </View>
          <ReleaseActionPill
            latestVersion={availableUpdate?.latestVersion}
            onPress={
              availableUpdate ? openAppUpdate : () => router.push(routes.settingsReleaseNotes)
            }
          />
        </IconHero>

        <SearchInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search settings"
          accessibilityLabel="Search settings"
          testID="settings-search"
          style={styles.search}
        />

        {searching ? (
          results.length > 0 ? (
            <SettingsCard>
              {results.map((hit) => {
                const visual = SECTION_VISUALS[hit.section.id]
                const directRoute = hit.item?.route
                return (
                  <SettingsRow
                    key={hit.id}
                    icon={visual.icon}
                    iconColor={visual.color}
                    label={hit.label}
                    hint={hit.hint}
                    onPress={() =>
                      router.push(
                        directRoute
                          ? (directRoute as Href)
                          : hit.focus
                            ? ({
                                pathname: hit.route,
                                params: { focus: hit.focus },
                              } as Href)
                            : (hit.route as Href),
                      )
                    }
                  />
                )
              })}
            </SettingsCard>
          ) : (
            <Text style={styles.noResults}>{`No settings match “${query.trim()}”.`}</Text>
          )
        ) : (
          SETTINGS_GROUPS.map((group) => (
            <Fragment key={group.title}>
              <SettingsSectionTitle>{group.title}</SettingsSectionTitle>
              <SettingsCard>
                {group.sections.map((section) => {
                  const visual = SECTION_VISUALS[section.id]
                  return (
                    <SettingsRow
                      key={section.id}
                      icon={visual.icon}
                      iconColor={visual.color}
                      label={section.label}
                      hint={section.id === 'units' ? unitsHint : section.hint}
                      onPress={() => router.push(section.route as Href)}
                    />
                  )
                })}
              </SettingsCard>
            </Fragment>
          ))
        )}
      </PageScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 8,
  },
  headerStats: {
    flexDirection: 'row',
    gap: 20,
  },
  headerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  headerValue: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  search: {
    alignSelf: 'center',
    width: '70%',
    marginBottom: 8,
  },
  noResults: {
    color: theme.neutral.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 16,
  },
})
