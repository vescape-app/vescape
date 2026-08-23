import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SquaresFourIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'
import {
  EdgeDrawerInitialFocusShowcase,
  EdgeDrawerLongContentShowcase,
  EdgeDrawerPositionShowcase,
  EdgeDrawerVirtualizedShowcase,
  FloatingSheetShowcase,
} from '@/screens/showcase/modals/DrawerShowcases'
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
          description="FadeCardModal, ConfirmModal, InfoModal, VersionNoticeModal, CommunityMessageModal, AppBlockScreen, TextPromptModal, EdgeDrawer, FloatingSheet."
        />
        <FadeCardModalShowcase />
        <ConfirmModalShowcase />
        <InfoModalShowcase />
        <VersionNoticeModalShowcase />
        <CommunityMessageModalShowcase />
        <AppBlockScreenShowcase />
        <TextPromptModalShowcase />
        <TextPromptModalClearableShowcase />
        <EdgeDrawerPositionShowcase
          edge="auto"
          name="EdgeDrawer — automatic edge"
          description="Chooses top or bottom from the trigger's current screen position."
        />
        <EdgeDrawerPositionShowcase
          edge="top"
          name="EdgeDrawer — top edge"
          description="Always opens from the top. The complete drawer follows an upward drag."
        />
        <EdgeDrawerPositionShowcase
          edge="bottom"
          name="EdgeDrawer — bottom edge"
          description="Always opens from the bottom. The complete drawer follows a downward drag."
        />
        <EdgeDrawerLongContentShowcase />
        <EdgeDrawerVirtualizedShowcase />
        <EdgeDrawerInitialFocusShowcase />
        <FloatingSheetShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
