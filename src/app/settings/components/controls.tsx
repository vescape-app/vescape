import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SwatchesIcon } from 'phosphor-react-native'

import { AlertPresetControlShowcase } from '@/screens/showcase/controls/AlertPresetControlShowcase'
import {
  CircleButtonShowcase,
  FloatingActionPillShowcase,
  FloatingBarShowcase,
  NavigationTopBarShowcase,
  PrevNextSelectorShowcase,
  SegmentedToggleShowcase,
} from '@/screens/showcase/controls/ButtonShowcases'
import { ExpandableCircleMenuShowcase } from '@/screens/showcase/controls/ExpandableCircleMenuShowcase'
import { ZonePillsShowcase } from '@/screens/showcase/controls/ZonePillsShowcase'
import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'

export default function ControlsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={SwatchesIcon}
          description="CircleButton, ExpandableCircleMenu, FloatingBar, PrevNextSelector, PillSelector, AlertPresetControl."
        />
        <AlertPresetControlShowcase />
        <CircleButtonShowcase />
        <NavigationTopBarShowcase />
        <FloatingBarShowcase />
        <FloatingActionPillShowcase />
        <PrevNextSelectorShowcase />
        <SegmentedToggleShowcase />
        <ZonePillsShowcase />
        <ExpandableCircleMenuShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
