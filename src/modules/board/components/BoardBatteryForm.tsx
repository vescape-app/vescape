import { useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import type { BatteryConfig } from 'vescape-core'

import { Select, type SelectOption } from '@/components/forms/Select'
import { Stepper } from '@/components/forms/Stepper'
import { Input } from '@/components/forms/Input'
import { theme } from '@/constants/theme'
import {
  BATTERY_CELL_PRESETS,
  DEFAULT_BATTERY_CONFIG,
  deriveBatteryConfig,
  getBatteryPreset,
} from '@/modules/battery/lib'
import { parseVoltage } from '@/modules/board/lib/boardSetup'

type BatteryMode = BatteryConfig['mode']

interface BoardBatteryFormProps {
  batteryMode: BatteryMode
  cellPresetId: string
  seriesCount: number
  parallelCount: number
  manualMinVoltage: string
  manualMaxVoltage: string
  onChangeBatteryMode: (mode: BatteryMode) => void
  onChangeCellPresetId: (value: string) => void
  onChangeSeriesCount: (value: number) => void
  onChangeParallelCount: (value: number) => void
  onChangeManualMinVoltage: (value: string) => void
  onChangeManualMaxVoltage: (value: string) => void
  testIDPrefix?: string
}

export function BoardBatteryForm({
  batteryMode,
  cellPresetId,
  seriesCount,
  parallelCount,
  manualMinVoltage,
  manualMaxVoltage,
  onChangeBatteryMode,
  onChangeCellPresetId,
  onChangeSeriesCount,
  onChangeParallelCount,
  onChangeManualMinVoltage,
  onChangeManualMaxVoltage,
  testIDPrefix,
}: BoardBatteryFormProps) {
  const selectedPreset =
    getBatteryPreset(cellPresetId) ?? getBatteryPreset(DEFAULT_BATTERY_CONFIG.cellPresetId)
  const formFactors = useMemo(
    () => unique(BATTERY_CELL_PRESETS.map((preset) => preset.formFactor)),
    [],
  )
  const formFactorOptions = useMemo<SelectOption[]>(
    () => formFactors.map((formFactor) => ({ label: formFactor, value: formFactor })),
    [formFactors],
  )
  const selectedFormFactor = selectedPreset?.formFactor ?? formFactors[0]
  const brands = useMemo(
    () =>
      unique(
        BATTERY_CELL_PRESETS.filter((preset) => preset.formFactor === selectedFormFactor).map(
          (preset) => preset.brand,
        ),
      ),
    [selectedFormFactor],
  )
  const brandOptions = useMemo<SelectOption[]>(
    () => brands.map((brand) => ({ label: brand, value: brand })),
    [brands],
  )
  const selectedBrand = selectedPreset?.brand ?? brands[0]
  const models = useMemo(
    () =>
      BATTERY_CELL_PRESETS.filter(
        (preset) => preset.formFactor === selectedFormFactor && preset.brand === selectedBrand,
      ),
    [selectedBrand, selectedFormFactor],
  )
  const modelOptions = useMemo<SelectOption[]>(
    () =>
      models.map((preset) => ({
        label: `${preset.model}${preset.verified ? '' : ' (unverified)'}`,
        value: preset.id,
      })),
    [models],
  )
  const draftWarning = deriveBatteryConfig(
    batteryMode === 'preset'
      ? { mode: 'preset', cellPresetId, seriesCount, parallelCount }
      : {
          mode: 'manual',
          minVoltage: parseVoltage(manualMinVoltage) ?? 0,
          maxVoltage: parseVoltage(manualMaxVoltage) ?? 0,
        },
  ).warning

  const choosePreset = (next: { formFactor?: string; brand?: string; cellPresetId?: string }) => {
    if (next.cellPresetId) {
      onChangeCellPresetId(next.cellPresetId)
      return
    }
    const formFactor = next.formFactor ?? selectedFormFactor
    const brand =
      next.brand ??
      BATTERY_CELL_PRESETS.find((preset) => preset.formFactor === formFactor)?.brand ??
      selectedBrand
    const preset = BATTERY_CELL_PRESETS.find(
      (candidate) => candidate.formFactor === formFactor && candidate.brand === brand,
    )
    if (preset) onChangeCellPresetId(preset.id)
  }

  return (
    <View style={styles.form}>
      <View style={styles.segmented}>
        <Pressable
          style={[styles.segment, batteryMode === 'preset' && styles.segmentActive]}
          onPress={() => onChangeBatteryMode('preset')}
          testID={testIDPrefix ? `${testIDPrefix}-preset-mode` : undefined}
        >
          <Text style={[styles.segmentText, batteryMode === 'preset' && styles.segmentTextActive]}>
            Preset
          </Text>
        </Pressable>
        <Pressable
          style={[styles.segment, batteryMode === 'manual' && styles.segmentActive]}
          onPress={() => onChangeBatteryMode('manual')}
          testID={testIDPrefix ? `${testIDPrefix}-manual-mode` : undefined}
        >
          <Text style={[styles.segmentText, batteryMode === 'manual' && styles.segmentTextActive]}>
            Manual
          </Text>
        </Pressable>
      </View>

      {batteryMode === 'preset' ? (
        <>
          <View style={styles.selectGrid}>
            <View style={styles.selectField}>
              <Text style={styles.label}>Form factor</Text>
              <Select
                options={formFactorOptions}
                value={selectedFormFactor}
                onChange={(formFactor) => choosePreset({ formFactor })}
              />
            </View>
            <View style={styles.selectField}>
              <Text style={styles.label}>Brand</Text>
              <Select
                options={brandOptions}
                value={selectedBrand}
                onChange={(brand) => choosePreset({ brand })}
              />
            </View>
          </View>
          <Text style={styles.label}>Model</Text>
          <Select
            options={modelOptions}
            value={cellPresetId}
            onChange={(nextPresetId) => choosePreset({ cellPresetId: nextPresetId })}
          />
          <View style={styles.stepperGrid}>
            <View style={styles.stepperField}>
              <Text style={styles.label}>Series</Text>
              <Stepper
                value={seriesCount}
                min={1}
                max={40}
                onChange={onChangeSeriesCount}
                fullWidth
                testIDPrefix={testIDPrefix ? `${testIDPrefix}-series` : undefined}
              />
            </View>
            <View style={styles.stepperField}>
              <Text style={styles.label}>Parallel</Text>
              <Stepper
                value={parallelCount}
                min={1}
                max={20}
                onChange={onChangeParallelCount}
                fullWidth
                testIDPrefix={testIDPrefix ? `${testIDPrefix}-parallel` : undefined}
              />
            </View>
          </View>
        </>
      ) : (
        <View style={styles.selectGrid}>
          <Input
            style={styles.voltageInput}
            value={manualMinVoltage}
            onChangeText={onChangeManualMinVoltage}
            placeholder="Min (0%)"
            placeholderTextColor={theme.neutral.textDim}
            keyboardType="decimal-pad"
            testID={testIDPrefix ? `${testIDPrefix}-manual-min-input` : undefined}
          />
          <Input
            style={styles.voltageInput}
            value={manualMaxVoltage}
            onChangeText={onChangeManualMaxVoltage}
            placeholder="Max (100%)"
            placeholderTextColor={theme.neutral.textDim}
            keyboardType="decimal-pad"
            testID={testIDPrefix ? `${testIDPrefix}-manual-max-input` : undefined}
          />
        </View>
      )}

      {draftWarning ? <Text style={styles.warning}>{draftWarning}</Text> : null}
    </View>
  )
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

const styles = StyleSheet.create({
  form: {
    gap: 10,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: theme.neutral.surfaceDeep,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    padding: 3,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 6,
    paddingVertical: 10,
  },
  segmentActive: {
    backgroundColor: theme.palette.cyan.bg,
  },
  segmentText: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  segmentTextActive: {
    color: theme.palette.cyan.text,
  },
  selectGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  selectField: {
    flex: 1,
    minWidth: 0,
  },
  stepperGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  stepperField: {
    flex: 1,
    gap: 6,
  },
  label: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  voltageInput: {
    flex: 1,
  },
  warning: {
    color: theme.status.warning.text,
    fontSize: 12,
    fontWeight: '600',
  },
})
