import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PlugsConnectedIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { AccessorySelectorSectionShowcase } from '@/screens/showcase/accessories/AccessorySelectorSectionShowcase'
import {
  AccessoryCapabilityRowShowcase,
  AccessoryCompatibilityNoticeShowcase,
} from '@/screens/showcase/accessories/AccessoryManifestShowcase'
import { theme } from '@/constants/theme'

export default function AccessoryComponentsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={PlugsConnectedIcon}
          description="Accessory discovery: the selector's Accessories section, compatibility verdicts, and capability rows."
        />
        <AccessorySelectorSectionShowcase />
        <AccessoryCompatibilityNoticeShowcase />
        <AccessoryCapabilityRowShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
