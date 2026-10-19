import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ToolboxIcon } from 'phosphor-react-native'

import { RingsEditorShowcase } from '@/screens/showcase/tune/RingsEditorShowcase'
import { RingsChartShowcase } from '@/screens/showcase/tune/RingsChartShowcase'
import { IconHero } from '@/components/settings/IconHero'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import {
  AlertPercentageTuneDialShowcase,
  CompactTuneDialShowcase,
  GeigerAlertTuneDialShowcase,
  TuneDialShowcase,
} from '@/screens/showcase/tune/TuneDialShowcases'
import {
  BasicSliderCellShowcase,
  ManualTuneEditorShowcase,
  TuneProfileMetadataModalShowcase,
  TunePreviewShowcase,
  UnsupportedTunePreviewShowcase,
} from '@/screens/showcase/tune/TunePreviewShowcases'

export default function TunePage() {
  const neutral = useResolvedNeutralColors()
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: neutral.bg }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={ToolboxIcon}
          description="TuneDial, BasicSliderCell, Tune Preview, Movement Board Test, RingsChart, TuneGroupGrid."
        />
        <RingsEditorShowcase />
        <RingsChartShowcase />
        <ManualTuneEditorShowcase />
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
  container: { flex: 1 },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
