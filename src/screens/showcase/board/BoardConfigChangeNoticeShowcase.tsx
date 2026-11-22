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

  const handleToggleIgnore = (fieldId: string, ignored: boolean) => {
    if (simulateError) return
    setIgnoredFields((prev) =>
      ignored
        ? prev.includes(fieldId)
          ? prev
          : [...prev, fieldId]
        : prev.filter((id) => id !== fieldId),
    )
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
          {DEMO_DIFFS.length} shown · {ignoredFields.length} ignored
        </Text>
        <View style={styles.actions}>
          <Button label="Show change notice" onPress={() => setModalOpen(true)} />
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
        visible={modalOpen}
        boardName="Thor400"
        diffs={DEMO_DIFFS}
        ignoredFields={ignoredFields}
        error={simulateError ? 'Could not update ignored field.' : null}
        onDismiss={() => setModalOpen(false)}
        onToggleIgnoreField={handleToggleIgnore}
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
