import { ScrollView, StyleSheet, Switch } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import {
  EngineIcon,
  ListIcon,
  NavigationArrowIcon,
  WarningDiamondIcon,
} from 'phosphor-react-native'

import { routes } from '@/navigation/routes'
import { theme } from '@/constants/theme'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { IconHero } from '@/components/settings/IconHero'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

export default function DiagnosticsSettingsScreen() {
  const boardWarningsEnabled = useSettingsStore((s) => s.boardWarningsEnabled)
  const vescFaultCollectionEnabled = useSettingsStore((s) => s.vescFaultCollectionEnabled)
  const set = useSettingsStore((s) => s.set)

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={EngineIcon}
          description="Board health checks that watch telemetry and flag problems while you ride, plus live GPS and heading evidence."
        />

        <SettingsCard>
          <SettingsRow
            icon={EngineIcon}
            iconColor={theme.status.warning.color}
            label="Board warnings"
            hint="Master switch — off stops all detection and hides warnings"
            right={
              <Switch
                value={boardWarningsEnabled}
                onValueChange={(v) => void set('boardWarningsEnabled', v)}
                trackColor={{ false: theme.neutral.border, true: theme.palette.sky.border }}
                thumbColor={
                  boardWarningsEnabled ? theme.palette.sky.color : theme.neutral.textMuted
                }
              />
            }
          />
          <SettingsRow
            icon={WarningDiamondIcon}
            iconColor={theme.status.caution.color}
            label="VESC fault collection"
            hint="Record live Refloat faults. Controller log loads when the fault drawer opens"
            right={
              <Switch
                value={vescFaultCollectionEnabled}
                onValueChange={(v) => void set('vescFaultCollectionEnabled', v)}
                trackColor={{ false: theme.neutral.border, true: theme.palette.sky.border }}
                thumbColor={
                  vescFaultCollectionEnabled ? theme.palette.sky.color : theme.neutral.textMuted
                }
              />
            }
          />
          <SettingsRow
            icon={ListIcon}
            iconColor={theme.palette.cyan.color}
            label="Event log"
            hint="Browse locally persisted diagnostic events"
            onPress={() => router.push(routes.settingsDiagnosticEvents)}
          />
          <SettingsRow
            icon={NavigationArrowIcon}
            iconColor={theme.palette.sky.color}
            label="Navigation diagnostics"
            hint="Live map heading, GPS, and fallback evidence"
            onPress={() => router.push(routes.settingsNavigationDiagnostic)}
          />
        </SettingsCard>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  content: {
    padding: 16,
    gap: 8,
  },
})
