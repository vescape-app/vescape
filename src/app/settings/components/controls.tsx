import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SwatchesIcon } from 'phosphor-react-native'

import { AlertPresetControlShowcase } from '@/screens/showcase/controls/AlertPresetControlShowcase'
import {
  CircleButtonShowcase,
  FloatingActionPillShowcase,
  FloatingBarShowcase,
  PrevNextSelectorShowcase,
} from '@/screens/showcase/controls/ButtonShowcases'
import { MapOptionSelectorShowcase } from '@/screens/showcase/controls/MapOptionSelectorShowcase'
import { ZonePillsShowcase } from '@/screens/showcase/controls/ZonePillsShowcase'
import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'

export default function ControlsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={SwatchesIcon}
          description="CircleButton, FloatingBar, PrevNextSelector, PillSelector, MapOptionSelector, AlertPresetControl."
        />
        <AlertPresetControlShowcase />
        <CircleButtonShowcase />
        <FloatingBarShowcase />
        <FloatingActionPillShowcase />
        <PrevNextSelectorShowcase />
        <ZonePillsShowcase />
        <MapOptionSelectorShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
