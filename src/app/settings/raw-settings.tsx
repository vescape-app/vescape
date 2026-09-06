import { useMemo } from 'react'
import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BracketsCurlyIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { RawSection } from '@/components/settings/RawSection'
import { theme } from '@/constants/theme'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

// Store keys that are actions/flags, not persisted setting data.
const APP_STORE_OMIT = new Set(['loaded', 'load', 'set', 'setCompanionPresence'])

function pickData(source: Record<string, unknown>, omit: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (omit.has(key) || typeof value === 'function') continue
    out[key] = value
  }
  return out
}

export default function RawSettingsScreen() {
  const settingsState = useSettingsStore()
  const boards = useBoardStore((s) => s.boards)
  const activeBoardId = useBoardStore((s) => s.activeBoardId)

  const appData = useMemo(
    () => pickData(settingsState as unknown as Record<string, unknown>, APP_STORE_OMIT),
    [settingsState],
  )
  const activeBoard = useMemo(
    () => boards.find((b) => b.id === activeBoardId) ?? null,
    [boards, activeBoardId],
  )

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={BracketsCurlyIcon}
          description="Raw app settings and current board record, exactly as stored."
        />

        <RawSection title="App settings" data={appData} exportName="app-settings" />

        <RawSection
          title={activeBoard ? `Active board · ${activeBoard.name}` : 'Active board'}
          data={activeBoard}
          exportName="board"
          empty="No board selected"
        />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  content: {
    padding: 16,
    gap: 8,
  },
})
