import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PlugsConnectedIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { AccessorySelectorSectionShowcase } from '@/screens/showcase/accessories/AccessorySelectorSectionShowcase'
import {
  AccessoryCapabilityRowShowcase,
  AccessoryCompatibilityNoticeShowcase,
  GroundClearanceReadoutShowcase,
} from '@/screens/showcase/accessories/AccessoryManifestShowcase'
import { SensorReadoutShowcase } from '@/screens/showcase/accessories/SensorReadoutShowcase'
import { theme } from '@/constants/theme'

export default function AccessoryComponentsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={PlugsConnectedIcon}
          description="Accessories: the selector's section, compatibility verdicts, capability rows, and the live ground-clearance readout."
        />
        <AccessorySelectorSectionShowcase />
        <AccessoryCompatibilityNoticeShowcase />
        <AccessoryCapabilityRowShowcase />
        <GroundClearanceReadoutShowcase />
        <SensorReadoutShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
