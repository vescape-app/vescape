import { useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { GearSixIcon } from 'phosphor-react-native'
import type { BoardConfigChangeDiff } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ToggleRow } from '@/components/dev/ShowcaseControls'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { theme } from '@/constants/theme'
import { BoardConfigChangeNoticeModalView } from '@/modules/board/components/BoardConfigChangeNoticeModal'
import { BoardConfigOptionsSheetView } from '@/modules/board/components/BoardConfigOptionsSheet'

const DEMO_DIFFS: BoardConfigChangeDiff[] = [
  {
    fieldId: 'l_current_max',
    label: 'Motor current max',
    unit: 'A',
    oldValue: 160,
    newValue: 150,
  },
  {
    fieldId: 'l_temp_fet_start',
    label: 'FET temp start',
    unit: '°C',
    oldValue: 70,
    newValue: 75,
  },
  {
    fieldId: 'fault_adc1',
    label: 'Zone 1',
    unit: 'V',
    oldValue: 1.0,
    newValue: 1.2,
  },
  {
    fieldId: 'leds.enabled',
    label: 'Enable LEDs',
    unit: null,
    oldValue: true,
    newValue: false,
  },
]

const DEMO_LABELS: Record<string, string> = Object.fromEntries(
  DEMO_DIFFS.map((diff) => [diff.fieldId, diff.label]),
)

export function BoardConfigChangeNoticeShowcase() {
  const [modalOpen, setModalOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [simulateError, setSimulateError] = useState(false)
  const [ignoredFields, setIgnoredFields] = useState<string[]>([])
  const optionsAnchorRef = useRef<View>(null)

  const visibleDiffs = DEMO_DIFFS.filter((diff) => !ignoredFields.includes(diff.fieldId))

  const handleIgnore = (fieldId: string) => {
    if (simulateError) return
    const nextIgnored = ignoredFields.includes(fieldId)
      ? ignoredFields
      : [...ignoredFields, fieldId]
    setIgnoredFields(nextIgnored)
    if (DEMO_DIFFS.every((diff) => nextIgnored.includes(diff.fieldId))) {
      setModalOpen(false)
    }
  }

  return (
    <ShowcaseCard
      name="BoardConfigChangeNoticeModal"
      controls={
        <ToggleRow label="simulate error" value={simulateError} onToggle={setSimulateError} />
      }
    >
      <View style={styles.body}>
        <Text style={styles.summary}>
          {visibleDiffs.length} pending · {ignoredFields.length} ignored
        </Text>
        <View style={styles.actions}>
          <Button
            label="Show change notice"
            disabled={visibleDiffs.length === 0}
            onPress={() => setModalOpen(true)}
          />
          <View ref={optionsAnchorRef} collapsable={false}>
            <Button
              label="Open options sheet"
              variant="secondary"
              onPress={() => setOptionsOpen(true)}
            />
          </View>
          {ignoredFields.length > 0 ? (
            <Button label="Reset demo" variant="secondary" onPress={() => setIgnoredFields([])} />
          ) : null}
        </View>
      </View>

      <BoardConfigChangeNoticeModalView
        visible={modalOpen && visibleDiffs.length > 0}
        boardName="Thor400"
        diffs={visibleDiffs}
        error={simulateError ? 'Could not save ignored field.' : null}
        onDismiss={() => setModalOpen(false)}
        onIgnoreField={handleIgnore}
      />

      <EdgeDrawer
        visible={optionsOpen}
        triggerRef={optionsAnchorRef}
        title="Board config"
        icon={GearSixIcon}
        onClose={() => setOptionsOpen(false)}
      >
        <BoardConfigOptionsSheetView
          ignoredFields={ignoredFields}
          fieldLabels={DEMO_LABELS}
          error={simulateError ? 'Ignored fields could not be updated.' : null}
          onOpenRawConfig={() => setOptionsOpen(false)}
          onRestoreField={(fieldId) => {
            if (simulateError) return
            setIgnoredFields((prev) => prev.filter((id) => id !== fieldId))
          }}
          onRestoreAll={() => {
            if (simulateError) return
            setIgnoredFields([])
          }}
        />
      </EdgeDrawer>
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  body: {
    gap: 10,
  },
  summary: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
  },
  actions: {
    gap: 8,
  },
})
