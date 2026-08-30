import { forwardRef, useRef, useState } from 'react'
import type { View } from 'react-native'
import { EngineIcon, WarningDiamondIcon } from 'phosphor-react-native'
import { router } from 'expo-router'

import { BoardPill } from '@/modules/board/components/BoardPill'
import { BoardWarningsSheet } from '@/modules/board/components/BoardWarningsSheet'
import { VescFaultsSheet } from '@/modules/board/components/VescFaultsSheet'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { severityStatus } from '@/modules/board/constants/boardWarnings'
import { worstSeverity } from '@/modules/board/lib/boardWarnings'
import { indicatorFaults } from '@/modules/board/lib/vescFaults'
import { EMPTY_WARNINGS, useBoardWarningsStore } from '@/modules/board/store/boardWarningsStore'
import { EMPTY_FAULTS, useVescFaultsStore } from '@/modules/board/store/vescFaultsStore'
import { useBoardStore, type Board } from '@/modules/board/store/boardStore'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { showDevControls } from '@/config/env'
import { routes } from '@/navigation/routes'
import { theme } from '@/constants/theme'

interface ConnectedBoardPillProps {
  maxWidth: number
  activeBoardId: string | null
  activeBoard: Board | undefined
  bleStatus: string
  isReplay: boolean
  /** Faults use the replay session's synthetic Board during playback. */
  sessionBoardId: string | null
  onOpenSelector: () => void
  onDisconnect: () => void
}

/** Store subscriptions and drawer intents stay outside the pill's presentation. */
export const ConnectedBoardPill = forwardRef<View, ConnectedBoardPillProps>(
  function ConnectedBoardPill(
    { activeBoardId, activeBoard, sessionBoardId, isReplay, ...props },
    ref,
  ) {
    const warningRef = useRef<View>(null)
    const faultRef = useRef<View>(null)
    const [warningsOpen, setWarningsOpen] = useState(false)
    const [faultsOpen, setFaultsOpen] = useState(false)
    const warnings = useBoardWarningsStore((s) =>
      activeBoardId ? (s.warningsByBoard[activeBoardId] ?? EMPTY_WARNINGS) : EMPTY_WARNINGS,
    )
    const dismissedKinds = useBoardStore(
      (s) => s.boards.find((b) => b.id === activeBoardId)?.dismissedWarnings,
    )
    const faults = useVescFaultsStore((s) =>
      sessionBoardId ? (s.faultsByBoard[sessionBoardId] ?? EMPTY_FAULTS) : EMPTY_FAULTS,
    )
    const warningsEnabled = useSettingsStore((s) => s.boardWarningsEnabled)
    const faultsEnabled = useSettingsStore((s) => s.vescFaultCollectionEnabled)
    const recording = useBleStore((s) => s.recordDebugSession)
    const setRecording = useBleStore((s) => s.setRecordDebugSession)
    const severity = worstSeverity(
      dismissedKinds?.length ? warnings.filter((w) => !dismissedKinds.includes(w.kind)) : warnings,
    )

    return (
      <>
        <BoardPill
          {...props}
          ref={ref}
          name={activeBoard?.name ?? null}
          replay={isReplay && showDevControls}
          onEdit={
            activeBoard
              ? () =>
                  router.push({ pathname: routes.editBoard, params: { boardId: activeBoard.id } })
              : undefined
          }
          onStopRecording={showDevControls && recording ? () => setRecording(false) : undefined}
          warning={
            warningsEnabled && severity
              ? { severity, ref: warningRef, onPress: () => setWarningsOpen(true) }
              : undefined
          }
          fault={
            faultsEnabled && indicatorFaults(faults).length > 0
              ? { ref: faultRef, onPress: () => setFaultsOpen(true) }
              : undefined
          }
        />
        {warningsEnabled && activeBoardId && (
          <EdgeDrawer
            visible={warningsOpen}
            triggerRef={warningRef}
            title="Warnings"
            icon={EngineIcon}
            iconColor={severityStatus(severity ?? 'warn').color}
            onClose={() => setWarningsOpen(false)}
          >
            <BoardWarningsSheet boardId={activeBoardId} warnings={warnings} />
          </EdgeDrawer>
        )}
        {faultsEnabled && sessionBoardId && (
          <EdgeDrawer
            visible={faultsOpen}
            triggerRef={faultRef}
            title="VESC faults"
            icon={WarningDiamondIcon}
            iconColor={theme.status.caution.color}
            onClose={() => setFaultsOpen(false)}
          >
            <VescFaultsSheet
              key={sessionBoardId}
              boardId={sessionBoardId}
              faults={faults}
              visible={faultsOpen}
            />
          </EdgeDrawer>
        )}
      </>
    )
  },
)
