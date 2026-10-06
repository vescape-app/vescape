import type { RefObject } from 'react'
import { StyleSheet, View } from 'react-native'
import {
  ArrowsDownUpIcon,
  JoystickIcon,
  LightbulbIcon,
  ScalesIcon,
  SlidersHorizontalIcon,
} from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { TabbedEdgeDrawer, type DrawerTab } from '@/components/overlays/TabbedEdgeDrawer'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'
import { BoardLightsControl } from '@/modules/board/components/BoardLightsControl'
import { BoardMoveControl } from '@/modules/board/components/BoardMoveControl'
import { RemoteTiltControl } from '@/modules/board/components/RemoteTiltControl'
import { canRunFirmwareCommand } from '@/modules/board/lib/boardLinkIntegrity'
import { useBleStore } from '@/modules/board/store/bleStore'
import { BoardLegalTab } from '@/screens/main/overlays/BoardLegalTab'
import { BoardTuneTab } from '@/screens/main/overlays/BoardTuneTab'
import { useDrawerTab } from '@/screens/main/overlays/useDrawerTab'

type BoardTab = 'lights' | 'tilt' | 'tune' | 'move' | 'legal'

const BOARD_TABS: readonly DrawerTab<BoardTab>[] = [
  { id: 'lights', label: 'Lights', icon: LightbulbIcon, color: theme.light.accent },
  { id: 'tilt', label: 'Tilt', icon: JoystickIcon, color: theme.palette.sky.color },
  { id: 'tune', label: 'Tune', icon: SlidersHorizontalIcon, color: theme.tune.color },
  { id: 'move', label: 'Move', icon: ArrowsDownUpIcon, color: theme.palette.cyan.color },
  { id: 'legal', label: 'Legal', icon: ScalesIcon, color: theme.status.error.color },
]

export function useBoardDrawerTab() {
  return useDrawerTab('boardDrawerTab', BOARD_TABS, 'tune')
}

interface BoardDrawerProps {
  visible: boolean
  triggerRef: RefObject<View | null>
  tab: BoardTab
  onTabChange: (tab: BoardTab) => void
  onClose: () => void
  onOpenLegalLimits: () => void
}

/** Board controls, opened from the bottom-right button: one full view per control. */
export function BoardDrawer({
  visible,
  triggerRef,
  tab,
  onTabChange,
  onClose,
  onOpenLegalLimits,
}: BoardDrawerProps) {
  return (
    <TabbedEdgeDrawer
      visible={visible}
      triggerRef={triggerRef}
      side="right"
      tabs={BOARD_TABS}
      activeTab={tab}
      onTabChange={onTabChange}
      onClose={onClose}
      testID="board-drawer"
    >
      {tab === 'lights' ? (
        <LightsTab />
      ) : tab === 'tilt' ? (
        <PanelTab>
          <RemoteTiltControl />
        </PanelTab>
      ) : tab === 'tune' ? (
        <BoardTuneTab onNavigate={onClose} />
      ) : tab === 'move' ? (
        <PanelTab>
          <BoardMoveControl />
        </PanelTab>
      ) : (
        <BoardLegalTab
          onOpenLegalLimits={() => {
            onClose()
            onOpenLegalLimits()
          }}
        />
      )}
    </TabbedEdgeDrawer>
  )
}

function LightsTab() {
  const boardConnected = useBleStore((state) => state.status === 'connected')
  const linkIntegrity = useBleStore((state) => state.linkIntegrity)
  const quickControlsEnabled = boardConnected && canRunFirmwareCommand(linkIntegrity)

  return (
    <View style={styles.content}>
      <BoardLightsControl enabled={quickControlsEnabled} />
      {boardConnected && !quickControlsEnabled ? (
        <Text style={styles.note}>Lights waiting for trusted board link.</Text>
      ) : !boardConnected ? (
        <Text style={styles.note}>Connect your board to switch its lights.</Text>
      ) : null}
    </View>
  )
}

function PanelTab({ children }: { children: React.ReactNode }) {
  const surface = useResolvedSecondaryWidgetSurface()
  return <View style={[surface, styles.panel]}>{children}</View>
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
  },
  panel: {
    padding: 14,
  },
  note: {
    color: theme.neutral.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
})
