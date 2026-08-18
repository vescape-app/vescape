import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StackIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'
import {
  CanvasWidgetShowcase,
  CollapsibleWidgetShowcase,
  DialWidgetShowcase,
  SwitchWidgetShowcase,
} from '@/screens/showcase/widgets/DisplayWidgetShowcases'
import {
  InputWidgetShowcase,
  LinkWidgetShowcase,
  SelectWidgetShowcase,
  StepperWidgetShowcase,
} from '@/screens/showcase/widgets/InputWidgetShowcases'

export default function WidgetsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={StackIcon}
          description="Reusable dashboard widgets with full, half and square footprints where each control supports them."
        />
        <InputWidgetShowcase />
        <LinkWidgetShowcase />
        <SelectWidgetShowcase />
        <StepperWidgetShowcase />
        <CollapsibleWidgetShowcase />
        <SwitchWidgetShowcase />
        <DialWidgetShowcase />
        <CanvasWidgetShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
