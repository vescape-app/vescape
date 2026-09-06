import { StyleSheet, View } from 'react-native'
import { useMemo, useState } from 'react'
import { useSharedValue } from 'react-native-reanimated'

import {
  FieldEditorPopover,
  type FieldEditorTarget,
} from '@/modules/tune/components/FieldEditorPopover'
import {
  TuneProfileIcon,
  TuneProfileMetadataModal,
  tuneProfileColorTheme,
  type TuneProfileMetadataValue,
} from '@/modules/tune/components/TuneProfileMetadataModal'
import { basicSliderColor, basicSliderIcon } from '@/modules/tune/components/basicSliderIcons'
import { useTriggerRef } from '@/components/forms/Dropdown'
import { BasicSliderCell } from '@/modules/tune/components/BasicSliderCell'
import { TunePreview } from '@/modules/tune/components/TunePreview'
import {
  TunePreviewScenarioControls,
  type HillsPresetId,
} from '@/modules/tune/components/TunePreviewScenarioControls'
import { Text } from '@/components/base/Text'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, OpenButton, ValueRow } from '@/components/dev/ShowcaseControls'

import type { BasicSliderItem } from '@/modules/tune/lib/sliderDefinitions'

export function BasicSliderCellShowcase() {
  const triggerRef = useTriggerRef()
  const [value, setValue] = useState(6.5)
  const [editorOpen, setEditorOpen] = useState(false)
  const edgeItems: BasicSliderItem[] = useMemo(
    () =>
      [0, 100].map((edgeValue) => ({
        id: `mock-aggressiveness-${edgeValue}`,
        label: 'Aggressiveness',
        description: 'Controls how strongly the board stays balanced.',
        value: edgeValue,
        min: 0,
        max: 100,
        step: 1,
        source: 'Profile: Street',
        info: 'Shows progress fill at the range edge.',
        modifiedManually: false,
      })),
    [],
  )
  const mockItem: BasicSliderItem = useMemo(
    () => ({
      id: 'mock-angle',
      label: 'Pushback angle',
      description: 'Sets how far the nose lifts during pushback.',
      value,
      min: 0,
      max: 15,
      step: 0.5,
      source: 'Profile: Street',
      info: 'Sets the tilt angle for pushback notification.',
      modifiedManually: true,
    }),
    [value],
  )
  const editorTarget: FieldEditorTarget | null = editorOpen
    ? {
        triggerRef,
        label: mockItem.label,
        fieldId: mockItem.id,
        value,
        min: mockItem.min,
        max: mockItem.max,
        step: mockItem.step,
        unit: 'deg',
        help: mockItem.info,
        icon: basicSliderIcon(mockItem.id),
        color: basicSliderColor(mockItem.id),
      }
    : null

  return (
    <>
      <ShowcaseCard
        name="BasicSliderCell + automatic-edge tune editor"
        controls={<ValueRow label="applied value" value={value} />}
      >
        <View style={styles.basicSliderShowcaseSingle}>
          <BasicSliderCell
            ref={triggerRef}
            item={mockItem}
            icon={basicSliderIcon(mockItem.id)}
            color={basicSliderColor(mockItem.id)}
            editable
            onPress={() => setEditorOpen(true)}
            onResetFormula={() => setValue(6.5)}
          />
        </View>
        <View style={styles.basicSliderShowcaseGrid}>
          {edgeItems.map((edgeItem) => (
            <BasicSliderCell
              key={edgeItem.id}
              item={edgeItem}
              icon={basicSliderIcon('aggressiveness')}
              color={basicSliderColor('aggressiveness')}
              editable={false}
              onPress={() => {}}
            />
          ))}
        </View>
      </ShowcaseCard>
      <FieldEditorPopover
        target={editorTarget}
        onCancel={() => setEditorOpen(false)}
        onApply={(nextValue) => {
          setValue(nextValue)
          setEditorOpen(false)
        }}
      />
    </>
  )
}

export function TunePreviewShowcase() {
  const pitchInputDegrees = useSharedValue(0)
  const pitchInputActive = useSharedValue(false)
  const previewSpeedKmh = useSharedValue(15)
  const groundToBoardAngleDegrees = useSharedValue(0)
  const [scenario, setScenario] = useState('flat')
  const [hillsPreset, setHillsPreset] = useState<HillsPresetId>('flat')
  const [hillHeightMeters, setHillHeightMeters] = useState(2.5)
  const [hillSpacingMeters, setHillSpacingMeters] = useState(30)
  const hillsEnabled = hillsPreset !== 'flat'
  const fields = useMemo(
    () => ({
      kp: 20,
      kp2: 0.6,
      ki: 0.02,
      mahony_kp: 2,
      mahony_kp_roll: 1.4,
      torquetilt_strength: 0.1,
      torquetilt_strength_regen: 0.12,
      torquetilt_start_current: 15,
      torquetilt_angle_limit: 8,
      torquetilt_on_speed: 10,
      torquetilt_off_speed: 8,
      braketilt_strength: 10,
      braketilt_lingering: 2,
      atr_on_speed: 10,
      atr_off_speed: 8,
      atr_strength_up: 1.5,
      atr_strength_down: 1.5,
      atr_threshold_up: 1,
      atr_threshold_down: 1,
      atr_speed_boost: 0.3,
      atr_angle_limit: 8,
      atr_response_boost: 1.5,
      atr_transition_boost: 1.5,
      atr_filter: 5,
      atr_amps_accel_ratio: 8,
      atr_amps_decel_ratio: 8,
      tiltback_constant: 1,
      tiltback_constant_erpm: 500,
      tiltback_variable: 0.3,
      tiltback_variable_max: 3,
      tiltback_variable_erpm: 1000,
    }),
    [],
  )

  const selectScenario = (next: string) => {
    setScenario(next)
    if (next === 'hills' || next === 'dense hills') {
      setHillsPreset('custom')
      setHillHeightMeters(next === 'dense hills' ? 5 : 2.5)
      setHillSpacingMeters(next === 'dense hills' ? 15 : 30)
    } else {
      setHillsPreset('flat')
    }
  }

  return (
    <ShowcaseCard
      name="Tune Preview"
      controls={
        <>
          <ChipRow
            label="state"
            options={['flat', 'hills', 'dense hills']}
            selected={scenario}
            onSelect={selectScenario}
          />
          <ValueRow label="pitch input" value="hold and drag" />
        </>
      }
    >
      <TunePreview
        fields={fields}
        pitchInputDegrees={pitchInputDegrees}
        pitchInputActive={pitchInputActive}
        hillsEnabled={hillsEnabled}
        hillHeightMeters={hillHeightMeters}
        hillSpacingMeters={hillSpacingMeters}
        onHelp={() => {}}
        speedKmh={previewSpeedKmh}
        groundToBoardAngleDegrees={groundToBoardAngleDegrees}
      />
      <TunePreviewScenarioControls
        hillsPreset={hillsPreset}
        onHillsPresetChange={setHillsPreset}
        hillHeightMeters={hillHeightMeters}
        onHillHeightChange={setHillHeightMeters}
        hillSpacingMeters={hillSpacingMeters}
        onHillSpacingChange={setHillSpacingMeters}
        pitchInputDegrees={pitchInputDegrees}
        pitchInputActive={pitchInputActive}
        speedKmh={previewSpeedKmh}
        groundToBoardAngleDegrees={groundToBoardAngleDegrees}
      />
    </ShowcaseCard>
  )
}

export function UnsupportedTunePreviewShowcase() {
  const pitchInputDegrees = useSharedValue(0)
  const pitchInputActive = useSharedValue(false)

  return (
    <ShowcaseCard name="Tune Preview — unsupported">
      <TunePreview
        fields={{ kp: 20 }}
        pitchInputDegrees={pitchInputDegrees}
        pitchInputActive={pitchInputActive}
        active={false}
        onHelp={() => {}}
      />
    </ShowcaseCard>
  )
}

export function TuneProfileMetadataModalShowcase() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<TuneProfileMetadataValue>({
    name: 'Street',
    icon: 'road-horizon',
    color: 'sky',
  })
  const color = tuneProfileColorTheme(value.color)

  return (
    <ShowcaseCard
      name="TuneProfileMetadataModal"
      controls={<OpenButton label="Edit" onPress={() => setOpen(true)} />}
    >
      <View
        style={[styles.profilePreview, { borderColor: color.border, backgroundColor: color.bg }]}
      >
        <TuneProfileIcon icon={value.icon} size={20} color={color.color} />
        <Text style={[styles.profilePreviewText, { color: color.color }]}>{value.name}</Text>
      </View>
      <TuneProfileMetadataModal
        visible={open}
        title="Edit Profile"
        confirmLabel="Save"
        initialValue={value}
        onConfirm={(next) => {
          setValue(next)
          setOpen(false)
        }}
        onDismiss={() => setOpen(false)}
      />
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  basicSliderShowcaseGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  basicSliderShowcaseSingle: {
    maxWidth: 200,
  },
  profilePreview: {
    alignSelf: 'flex-start',
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 19,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  profilePreviewText: {
    fontSize: 13,
    fontWeight: '800',
  },
})
