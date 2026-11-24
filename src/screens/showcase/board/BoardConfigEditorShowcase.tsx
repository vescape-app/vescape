import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/base/Button'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { BoardConfigFieldEditor } from '@/modules/board/components/BoardConfigFieldEditor'
import { BoardConfigReviewModal } from '@/modules/board/components/BoardConfigReviewModal'
import {
  buildBoardConfigReviewEntries,
  type BoardConfigReviewSource,
  type BoardConfigSkippedField,
} from '@/modules/board/lib/boardConfigChangeset'
import type { ResolvedBoardConfigField } from '@/modules/board/lib/refloatFieldOverlay'

const DEMO_FIELDS: ResolvedBoardConfigField[] = [
  {
    id: 'startup_simplestart_enabled',
    label: 'Simple start',
    value: true,
    unit: null,
    min: null,
    max: null,
    hardMin: null,
    hardMax: null,
    step: null,
    manualDecimals: null,
    displayScale: 1,
    editAsPercentage: false,
    enumNames: [],
    type: 'bool',
    description: 'Lets you start with just one footpad zone pressed.',
    placement: 'primary',
    hidden: false,
    risk: null,
    editable: true,
  },
  {
    id: 'leds.front.mode',
    label: 'Front pattern',
    value: 0,
    unit: null,
    min: 0,
    max: 3,
    hardMin: 0,
    hardMax: 3,
    step: 1,
    manualDecimals: 0,
    displayScale: 1,
    editAsPercentage: false,
    enumNames: ['Solid', 'Fade', 'Pulse', 'Rainbow'],
    type: 'uint8',
    description: 'Animation pattern from the XML enum names.',
    placement: 'primary',
    hidden: false,
    risk: null,
    editable: true,
  },
  {
    id: 'tiltback_duty',
    label: 'Duty pushback',
    value: 0.8,
    unit: '%',
    min: 0,
    max: 1,
    hardMin: 0,
    hardMax: 1,
    step: 0.01,
    manualDecimals: 0,
    displayScale: 100,
    editAsPercentage: true,
    enumNames: [],
    type: 'float16_scaled',
    description: 'Duty threshold where pushback begins.',
    placement: 'primary',
    hidden: false,
    risk: null,
    editable: true,
  },
  {
    id: 'fault_adc1',
    label: 'Zone 1 engages at',
    value: 2.0,
    unit: 'V',
    min: 0,
    max: 3.3,
    hardMin: 0,
    hardMax: 3.3,
    step: 0.1,
    manualDecimals: 2,
    displayScale: 1,
    editAsPercentage: false,
    enumNames: [],
    type: 'float16_scaled',
    description: 'Footpad sensor engagement voltage.',
    placement: 'primary',
    hidden: false,
    risk: 'risky',
    editable: true,
  },
  {
    id: 'hardware.leds.mode',
    label: 'LED output',
    value: 1,
    unit: null,
    min: 0,
    max: 3,
    hardMin: 0,
    hardMax: 3,
    step: 1,
    manualDecimals: 0,
    displayScale: 1,
    editAsPercentage: false,
    enumNames: ['Off', 'Internal', 'External', 'Internal & External'],
    type: 'uint8',
    description: 'Hardware LED driver mode.',
    placement: 'primary',
    hidden: false,
    risk: null,
    editable: true,
  },
  {
    id: 'meta.is_default',
    label: 'Config is default',
    value: false,
    unit: null,
    min: null,
    max: null,
    hardMin: null,
    hardMax: null,
    step: null,
    manualDecimals: null,
    displayScale: 1,
    editAsPercentage: false,
    enumNames: [],
    type: 'bool',
    description: 'Internal Refloat metadata flag.',
    placement: 'primary',
    hidden: false,
    risk: 'internal',
    editable: false,
  },
]

const BASE_VALUES: Record<string, number | boolean> = {
  startup_simplestart_enabled: true,
  'leds.front.mode': 0,
  tiltback_duty: 0.8,
  fault_adc1: 2.0,
  'hardware.leds.mode': 1,
  'meta.is_default': false,
}

const DEMO_SKIPPED: BoardConfigSkippedField[] = [
  {
    fieldId: 'atr_on_speed',
    label: 'Max Tiltback Speed',
    reason: 'Not present in current Refloat 1.3.0 schema',
  },
]

export function BoardConfigEditorShowcase() {
  const [values, setValues] = useState<Record<string, number | boolean>>({
    ...BASE_VALUES,
    fault_adc1: 2.2,
    'hardware.leds.mode': 2,
  })
  const [showDescriptions, setShowDescriptions] = useState(true)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [source, setSource] = useState<BoardConfigReviewSource>('app')
  const [simulateError, setSimulateError] = useState(false)
  const [showSkipped, setShowSkipped] = useState(false)

  const pendingChanges = useMemo(() => {
    const next: Record<string, number | boolean> = {}
    for (const field of DEMO_FIELDS) {
      if (!field.editable) continue
      const current = values[field.id]
      if (current !== undefined && current !== BASE_VALUES[field.id]) {
        next[field.id] = current
      }
    }
    return next
  }, [values])

  const reviewEntries = useMemo(
    () =>
      buildBoardConfigReviewEntries({
        changes:
          Object.keys(pendingChanges).length > 0
            ? pendingChanges
            : { fault_adc1: 2.2, 'hardware.leds.mode': 2, 'leds.on': false },
        currentValues: { ...BASE_VALUES, 'leds.on': true },
        refloatBaseVersion: '1.3.0',
      }),
    [pendingChanges],
  )

  return (
    <>
      <ShowcaseCard
        name="BoardConfigFieldEditor"
        controls={
          <ToggleRow
            label="show descriptions"
            value={showDescriptions}
            onToggle={setShowDescriptions}
          />
        }
      >
        <SettingsCard separatorInset={14}>
          {DEMO_FIELDS.map((field) => (
            <BoardConfigFieldEditor
              key={field.id}
              field={field}
              value={values[field.id] ?? field.value}
              isModified={field.editable && values[field.id] !== BASE_VALUES[field.id]}
              refloatBaseVersion="1.3.0"
              showDescription={showDescriptions}
              onChange={(fieldId, nextValue) =>
                setValues((prev) => ({ ...prev, [fieldId]: nextValue }))
              }
              onReset={(fieldId) =>
                setValues((prev) => ({ ...prev, [fieldId]: BASE_VALUES[fieldId]! }))
              }
            />
          ))}
        </SettingsCard>
      </ShowcaseCard>

      <ShowcaseCard
        name="BoardConfigReviewModal"
        controls={
          <>
            <ChipRow
              label="source"
              options={['app', 'revert', 'import']}
              selected={source}
              onSelect={(value) => setSource(value as BoardConfigReviewSource)}
            />
            <ToggleRow label="simulate error" value={simulateError} onToggle={setSimulateError} />
            <ToggleRow label="skipped fields" value={showSkipped} onToggle={setShowSkipped} />
          </>
        }
      >
        <View style={styles.actions}>
          <Button label="Open review modal" onPress={() => setReviewOpen(true)} />
        </View>
        <BoardConfigReviewModal
          visible={reviewOpen}
          source={source}
          boardName="Thor400"
          entries={reviewEntries}
          skippedFields={showSkipped ? DEMO_SKIPPED : []}
          error={
            simulateError
              ? 'Write refused: board must be stopped before writing configuration.'
              : null
          }
          onConfirm={() => {
            if (!simulateError) setReviewOpen(false)
          }}
          onCancel={() => setReviewOpen(false)}
        />
      </ShowcaseCard>
    </>
  )
}

const styles = StyleSheet.create({
  actions: {
    gap: 8,
  },
})
