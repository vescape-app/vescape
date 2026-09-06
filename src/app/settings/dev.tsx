import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import {
  CameraRotateIcon,
  CodeIcon,
  RecordIcon,
  SwatchesIcon,
  ToolboxIcon,
} from 'phosphor-react-native'

import { routes } from '@/navigation/routes'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'

// @parity /src/components/dev/DevBadge.tsx `DEV_PAGE_SHORTCUTS`
const DEV_PAGE_SHORTCUTS = [
  {
    label: 'Components library',
    hint: 'Browse all UI components with live props',
    route: routes.settingsComponents,
    icon: SwatchesIcon,
    iconColor: theme.palette.purple.color,
  },
  {
    label: 'Debug recordings',
    hint: 'Capture and export raw BLE sessions',
    route: routes.settingsDebugRecordings,
    icon: RecordIcon,
    iconColor: theme.status.warning.color,
  },
  {
    label: 'Camera playground',
    hint: 'Tune the spring camera engine against fake GPS',
    route: routes.devMapPlayground,
    icon: CameraRotateIcon,
    iconColor: theme.palette.violet.color,
  },
  {
    label: 'Other',
    hint: 'Small platform probes and local experiments',
    route: routes.settingsOther,
    icon: ToolboxIcon,
    iconColor: theme.palette.amber.color,
  },
]

export default function DevSettingsScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={CodeIcon}
          description="Diagnostics, local verification, and component previews."
        />
        <SettingsCard>
          {DEV_PAGE_SHORTCUTS.map((page) => (
            <SettingsRow
              key={page.label}
              icon={page.icon}
              iconColor={page.iconColor}
              label={page.label}
              hint={page.hint}
              onPress={() => router.push(page.route)}
            />
          ))}
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
