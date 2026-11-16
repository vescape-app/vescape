import { PageScrollView } from '@/components/base/PageScrollView'
import { StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { RowsIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'
import {
  EdgeDrawerInitialFocusShowcase,
  EdgeDrawerLateRowsShowcase,
  EdgeDrawerLongContentShowcase,
  EdgeDrawerPositionShowcase,
  EdgeDrawerResizeShowcase,
  EdgeDrawerVirtualizedShowcase,
  FloatingSheetShowcase,
} from '@/screens/showcase/modals/DrawerShowcases'

export default function DrawersPage() {
  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <PageScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={RowsIcon}
          description="Edge drawers blur the screen behind them on iOS and Android 12+. Drag to dismiss to see the blur fade with the drawer. Older Android versions keep the tinted backdrop. Floating sheets use a dimmed backdrop."
        />
        <EdgeDrawerResizeShowcase edge="bottom" />
        <EdgeDrawerResizeShowcase edge="top" />
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
        <EdgeDrawerLateRowsShowcase />
        <EdgeDrawerInitialFocusShowcase />
        <FloatingSheetShowcase />
      </PageScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
