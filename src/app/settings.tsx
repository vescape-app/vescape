import { useLayoutEffect } from 'react'
import { View, StyleSheet, ScrollView, Platform } from 'react-native'
import { Text } from '@/components/base/Text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useNavigation } from 'expo-router'
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
  WatchIcon,
  EngineIcon,
  MapTrifoldIcon,
  PaletteIcon,
  CpuIcon,
} from 'phosphor-react-native'

import { routes } from '@/navigation/routes'
import { theme } from '@/constants/theme'
import { DASH, formatBytes } from '@/helpers/format'
import { IconButton } from '@/components/base/IconButton'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { IconHero } from '@/components/settings/IconHero'
import { VescapeWordmark } from '@/components/base/VescapeWordmark'
import { useSettingsDatabaseOps } from '@/modules/settings/hooks/useSettingsDatabaseOps'
import { ReleaseActionPill } from '@/modules/release/components/ReleaseActionPill'
import { selectAvailableUpdate } from '@/modules/release/lib/availableUpdate'
import { useAppStatusStore } from '@/modules/release/store/appStatusStore'
import { openAppUpdate } from 'vescape-core'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

const appVersion = Constants.expoConfig?.version ?? DASH

export default function SettingsScreen() {
  const db = useSettingsDatabaseOps()
  const navigation = useNavigation()
  const appStatus = useAppStatusStore((state) => state.status)
  const availableUpdate = selectAvailableUpdate(appStatus)
  const neutral = useResolvedNeutralColors()

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
    <SafeAreaView style={[styles.container, { backgroundColor: neutral.bg }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
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

        <SettingsSectionTitle>General</SettingsSectionTitle>

        <SettingsCard>
          <SettingsRow
            icon={BluetoothConnectedIcon}
            iconColor={theme.settingsIcon.connection}
            label="Connection"
            hint="Auto start, auto connect, and sounds"
            onPress={() => router.push(routes.settingsConnection)}
          />
          <SettingsRow
            icon={GaugeIcon}
            iconColor={theme.settingsIcon.liveTelemetry}
            label="Live telemetry"
            hint="Graphs, update rate, and battery smoothing"
            onPress={() => router.push(routes.settingsLiveTelemetry)}
          />
          <SettingsRow
            icon={EngineIcon}
            iconColor={theme.settingsIcon.diagnostics}
            label="Diagnostics"
            hint="Board warnings and health checks"
            onPress={() => router.push(routes.settingsDiagnostics)}
          />
          <SettingsRow
            icon={PaletteIcon}
            iconColor={theme.palette.purple.color}
            label="Appearance"
            hint="System, light, dark, or sunrise and sunset"
            onPress={() => router.push(routes.settingsVisuals)}
          />
          <SettingsRow
            icon={MapTrifoldIcon}
            iconColor={theme.settingsIcon.map}
            label="Map"
            hint="Map appearance and satellite imagery"
            onPress={() => router.push(routes.settingsMap)}
          />
        </SettingsCard>

        {Platform.OS === 'android' && (
          <>
            <SettingsSectionTitle>Hardware</SettingsSectionTitle>

            <SettingsCard>
              <SettingsRow
                icon={WatchIcon}
                iconColor={theme.settingsIcon.watch}
                label="Watch"
                hint="Auto open and telemetry push rate"
                onPress={() => router.push(routes.settingsWatch)}
              />
              <SettingsRow
                icon={CpuIcon}
                iconColor={theme.palette.cyan.color}
                label="Sensors"
                hint="Connect Vescape sensors and controls over Bluetooth"
                onPress={() => router.push(routes.settingsSensors)}
              />
            </SettingsCard>
          </>
        )}

        <SettingsSectionTitle>Recording</SettingsSectionTitle>

        <SettingsCard>
          <SettingsRow
            icon={HouseIcon}
            iconColor={theme.settingsIcon.privacyZones}
            label="Privacy zones"
            hint="Skip recording near saved places"
            onPress={() => router.push(routes.settingsPrivacyZones)}
          />
          <SettingsRow
            icon={ClockCounterClockwiseIcon}
            iconColor={theme.settingsIcon.filters}
            label="History"
            hint="Ride splitting and ride data filtering"
            onPress={() => router.push(routes.settingsHistory)}
          />
          <SettingsRow
            icon={ChartLineUpIcon}
            iconColor={theme.settingsIcon.graphs}
            label="Graphs"
            hint="Hot gradients and color ramps"
            onPress={() => router.push(routes.settingsGraphs)}
          />
        </SettingsCard>

        <SettingsSectionTitle>Developer</SettingsSectionTitle>

        <SettingsCard>
          <SettingsRow
            icon={CodeIcon}
            iconColor={theme.settingsIcon.dev}
            label="Dev tools"
            hint="Diagnostics and local verification"
            onPress={() => router.push(routes.settingsDev)}
          />
          <SettingsRow
            icon={InfoIcon}
            iconColor={theme.settingsIcon.about}
            label="About us"
            hint="The people who built this app"
            onPress={() => router.push(routes.settingsAbout)}
          />
        </SettingsCard>
      </ScrollView>
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
})
