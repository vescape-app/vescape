import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ToolboxIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'
import {
  AlertPercentageTuneDialShowcase,
  CompactTuneDialShowcase,
  GeigerAlertTuneDialShowcase,
  TuneDialShowcase,
} from '@/screens/showcase/tune/TuneDialShowcases'
import {
  BasicSliderCellShowcase,
  TuneProfileMetadataModalShowcase,
  TunePreviewShowcase,
  UnsupportedTunePreviewShowcase,
} from '@/screens/showcase/tune/TunePreviewShowcases'

export default function TunePage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={ToolboxIcon}
          description="TuneDial, BasicSliderCell, Tune Preview, Movement Board Test, TuneSyncBar, TuneGroupGrid."
        />
        <TuneDialShowcase />
        <CompactTuneDialShowcase />
        <AlertPercentageTuneDialShowcase />
        <GeigerAlertTuneDialShowcase />
        <BasicSliderCellShowcase />
        <TuneProfileMetadataModalShowcase />
        <TunePreviewShowcase />
        <UnsupportedTunePreviewShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
