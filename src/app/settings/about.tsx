import { Linking, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CrownIcon, PaletteIcon, ShieldCheckIcon, UsersIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { theme } from '@/constants/theme'

const PRIVACY_POLICY_URL = 'https://vescape.app/privacy'

export default function AboutScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={UsersIcon}
          title="About us"
          description="The people who built this app, with a little less seriousness."
        />
        <SettingsCard>
          <SettingsRow
            icon={ShieldCheckIcon}
            iconColor={theme.palette.cyan.color}
            label="Privacy policy"
            hint="Data, Group Ride sharing, and contact"
            onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
          />
        </SettingsCard>
        <SettingsCard>
          <SettingsRow
            icon={CrownIcon}
            iconColor={theme.palette.sky.color}
            label="Kacper Kozak"
            hint="Look mom, I'm a king."
          />
          <SettingsRow
            icon={PaletteIcon}
            iconColor={theme.palette.yellow.color}
            label="Bartosz Kozak"
            hint="One more feature, app will hold it."
          />
        </SettingsCard>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.palette.slate.bg,
  },
  content: {
    padding: 16,
    gap: 8,
  },
})
