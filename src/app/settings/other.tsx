import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ToolboxIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'
import { BoardWarningProbe } from '@/screens/showcase/other/BoardWarningProbe'
import { HapticsProbe } from '@/screens/showcase/other/HapticsProbe'

export default function OtherSettingsScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero icon={ToolboxIcon} description="Small platform probes and local experiments." />
        <BoardWarningProbe />
        <HapticsProbe />
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
