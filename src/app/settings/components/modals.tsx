import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SquaresFourIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'
import {
  AppBlockScreenShowcase,
  ConfirmModalShowcase,
  FadeCardModalShowcase,
  InfoModalShowcase,
  VersionNoticeModalShowcase,
} from '@/screens/showcase/modals/ModalShowcases'
import {
  CommunityMessageModalShowcase,
  TextPromptModalClearableShowcase,
  TextPromptModalShowcase,
} from '@/screens/showcase/modals/PromptShowcases'

export default function ModalsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={SquaresFourIcon}
          description="FadeCardModal, ConfirmModal, InfoModal, VersionNoticeModal, CommunityMessageModal, AppBlockScreen, TextPromptModal."
        />
        <FadeCardModalShowcase />
        <ConfirmModalShowcase />
        <InfoModalShowcase />
        <VersionNoticeModalShowcase />
        <CommunityMessageModalShowcase />
        <AppBlockScreenShowcase />
        <TextPromptModalShowcase />
        <TextPromptModalClearableShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
