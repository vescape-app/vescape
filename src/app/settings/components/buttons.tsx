import { PageScrollView } from '@/components/base/PageScrollView'
import { StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CursorClickIcon } from 'phosphor-react-native'

import {
  ButtonShowcase,
  IconButtonExtensionShowcase,
  IconButtonShowcase,
} from '@/screens/showcase/buttons/ButtonShowcases'
import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'

export default function ButtonsPage() {
  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <PageScrollView contentContainerStyle={styles.content}>
        <IconHero icon={CursorClickIcon} description="Button, IconButton, IconButtonExtension." />
        <ButtonShowcase />
        <IconButtonShowcase />
        <IconButtonExtensionShowcase />
      </PageScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
