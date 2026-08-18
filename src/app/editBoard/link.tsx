import { useCallback, useRef, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { useShallow } from 'zustand/react/shallow'

import { LinkIcon } from 'phosphor-react-native'

import { BoardLinkTimeline } from '@/modules/board/components/BoardLinkTimeline'
import { IconHero } from '@/components/settings/IconHero'
import { Button } from '@/components/base/Button'
import { useBoardLink } from '@/modules/board/hooks/useBoardLink'
import { routes } from '@/navigation/routes'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { theme } from '@/constants/theme'

const LINK_STEP_ROW_HEIGHT = 76

export default function BoardLinkScreen() {
  const {
    boardId,
    bleId: routeBleId,
    bleName,
  } = useLocalSearchParams<{
    boardId: string
    bleId?: string
    bleName?: string
  }>()
  const { board, updateBoard } = useBoardStore(
    useShallow((s) => ({
      board: s.boards.find((b) => b.id === boardId),
      updateBoard: s.updateBoard,
    })),
  )

  // The peripheral to link: a freshly-scanned device, else the board's existing
  // link (re-link). The existing link is left intact until a new one is saved —
  // a cancelled or failed re-link must not destroy a working link.
  const [bleId] = useState(() => routeBleId ?? board?.link?.bleId ?? null)
  const existingLink = board?.link ?? null

  const link = useBoardLink(bleId, boardId)
  const [saving, setSaving] = useState(false)
  const scrollRef = useRef<ScrollView>(null)

  const handleActiveStepIndexChange = useCallback((index: number) => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: index < 0 ? 0 : Math.max(0, index * LINK_STEP_ROW_HEIGHT - LINK_STEP_ROW_HEIGHT),
        animated: true,
      })
    })
  }, [])

  const handleSave = async () => {
    if (!board) return
    setSaving(true)
    try {
      const finalized = link.selectedLink ?? (await link.finalize())
      if (!finalized) return
      await updateBoard({ ...board, link: finalized })
      router.back()
    } catch (err) {
      console.log('[board-link] save failed', err)
    } finally {
      setSaving(false)
    }
  }

  const scanNewDevice = () => {
    router.push({ pathname: routes.addBoardScan, params: { boardId } })
  }

  const deviceLabel = board?.name?.trim() || bleName || bleId || 'Board'

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <IconHero
        icon={LinkIcon}
        title={deviceLabel}
        description="Linking your board over Bluetooth"
      />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        {bleId != null ? (
          <BoardLinkTimeline
            phase={link.phase}
            progress={link.progress}
            candidates={link.candidates}
            selected={link.selected}
            onSelect={link.select}
            deviceLabel={deviceLabel}
            hideHeader
            bleId={bleId}
            testIDPrefix="board-link"
            failureNote={existingLink ? 'Existing link kept — your board still works' : undefined}
            onActiveStepIndexChange={handleActiveStepIndexChange}
          />
        ) : null}
      </ScrollView>

      {link.phase === 'failed' ? (
        <View style={[styles.footer, styles.actionRow]}>
          <Button
            style={styles.actionButton}
            label="Scan new device"
            variant="secondary"
            onPress={scanNewDevice}
            testID="board-link-choose-another"
          />
          <Button
            style={[styles.actionButton, styles.upgradeButton]}
            label="Retry"
            onPress={link.retry}
            testID="board-link-retry"
          />
        </View>
      ) : (
        <View style={styles.footer}>
          <Button
            style={styles.upgradeButton}
            label="Save link"
            onPress={handleSave}
            disabled={link.phase !== 'picking' || link.selected == null || link.isFinalizing}
            loading={saving || link.isFinalizing}
            testID="board-link-save"
          />
        </View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.palette.slate.bg,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 16,
    paddingBottom: 112,
    gap: 14,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
  },
  upgradeButton: {
    backgroundColor: theme.status.upgrade.color,
  },
})
