import { useCallback, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { ChatTextIcon, RadioactiveIcon, WaveformIcon } from 'phosphor-react-native'

import { Input } from '@/components/forms/Input'
import { SoundPicker } from '@/components/forms/SoundPicker'

import { Stepper } from '@/components/forms/Stepper'
import { TuneDial } from '@/modules/tune/components/TuneDial'
import { telemetryByControlId } from '@/modules/board/constants/telemetry'
import { theme } from '@/constants/theme'
import {
  DEFAULT_ALERT_SEEDS,
  type TelemetryAlertTab as AlertTab,
} from '@/modules/board/constants/telemetryThresholds'
import { type DerivedBatteryConfig } from '@/modules/battery/lib/types'
import { type AlertRuleDraft } from '@/modules/alerts/store/alertsStore'
import { type DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'
import {
  ALERT_BEEP_COUNT_DEFAULT,
  ALERT_BEEP_COUNT_RANGE,
  type AlertSound,
  type AlertSoundCategory,
  type AlertSoundType,
  getAlertSounds,
  previewAlertSound,
} from 'vescape-core'

/**
 * Repeat cadences offered to the rider, with `Off` as the one-shot choice. Deliberately coarse: the
 * difference between 12s and 15s is not a choice anyone can make meaningfully in a settings screen,
 * and native floors the value regardless.
 */
const REPEAT_INTERVAL_CHOICES = [5, 10, 30, 60] as const

function getPresetsForCategory(category: AlertSoundCategory): AlertSound[] {
  return getAlertSounds().filter((p) => p.category === category)
}

function getDefaultMessageTemplate(
  controlId: string,
  batteryConfig: DerivedBatteryConfig | null,
): string {
  if (controlId === 'battery') {
    return batteryConfig ? 'Battery {percent}%' : 'Battery {voltage}V'
  }
  const metric = telemetryByControlId[controlId]
  // Drop the "Temp" suffix — the °C unit already makes temperature obvious when spoken.
  if (metric) return `${metric.label.replace(/ Temp$/, '')} {value} {unit}`
  return '{value} {unit}'
}

function getMessagePlaceholders(
  controlId: string,
  batteryConfig: DerivedBatteryConfig | null,
): string[] {
  const base = ['{value}', '{threshold}', '{unit}']
  if (controlId === 'battery') {
    return [...base, batteryConfig ? '{percent}' : '{voltage}']
  }
  return base
}

function renderPreviewTemplate(
  template: string,
  threshold: number,
  unit: string,
  dialConfig: ReturnType<typeof getAlertDialConfig>,
  controlId: string,
  batteryConfig: DerivedBatteryConfig | null,
): string {
  const formatted = dialConfig.format(threshold)
  let result = template
    .replace(/\{value\}/g, formatted)
    .replace(/\{threshold\}/g, formatted)
    .replace(/\{unit\}/g, unit)
  if (controlId === 'battery') {
    if (batteryConfig) {
      result = result.replace(/\{percent\}/g, formatted)
    } else {
      result = result.replace(/\{voltage\}/g, formatted)
    }
  }
  return result
}

function getAlertDialConfig(controlId: string, batteryConfig: DerivedBatteryConfig | null) {
  if (controlId === 'battery' && batteryConfig) {
    return {
      min: 0,
      max: 100,
      step: 1,
      format: (v: number) => `${Math.round(v)}`,
      unit: '%',
    }
  }
  const metric = telemetryByControlId[controlId]
  if (!metric) return { min: 0, max: 100, step: 1, format: (v: number) => String(v), unit: '' }
  const step =
    metric.decimals === 0 ? 1 : Number(Math.pow(10, -metric.decimals).toFixed(metric.decimals))
  return {
    min: metric.chartRange.min,
    max: metric.chartRange.max,
    step,
    format: metric.format,
    unit: metric.unit,
  }
}

interface AlertFormModalProps {
  visible: boolean
  controlId: string
  unit: string
  editRule: DraftAlertRule | null
  batteryConfig: DerivedBatteryConfig | null
  onClose(): void
  onSave(draft: AlertRuleDraft): void
}

function getEditFormDefaults(
  editRule: DraftAlertRule,
  dialConfig: ReturnType<typeof getAlertDialConfig>,
  batteryConfig: DerivedBatteryConfig | null,
) {
  const isTts = editRule.soundType.startsWith('tts:')
  return {
    tab: (isTts ? 'message' : editRule.thresholdMax != null ? 'geiger' : 'single') as AlertTab,
    threshold: editRule.threshold,
    thresholdMax: editRule.thresholdMax ?? dialConfig.max,
    soundType: editRule.soundType,
    messageTemplate: isTts
      ? editRule.soundType.slice(4)
      : getDefaultMessageTemplate(editRule.controlId, batteryConfig),
    repeatEverySeconds: editRule.repeatEverySeconds,
    beepCount: editRule.beepCount,
  }
}

function getNewFormDefaults(
  dialConfig: ReturnType<typeof getAlertDialConfig>,
  defaultSoundType: AlertSoundType,
  geigerSoundType: AlertSoundType,
  controlId: string,
  batteryConfig: DerivedBatteryConfig | null,
) {
  const snap = (v: number) =>
    Math.min(
      dialConfig.max,
      Math.max(dialConfig.min, Math.round(v / dialConfig.step) * dialConfig.step),
    )
  const high = snap(dialConfig.min + (dialConfig.max - dialConfig.min) * 0.75)

  const preset = DEFAULT_ALERT_SEEDS[controlId]
  if (preset) {
    return {
      tab: preset.tab,
      threshold: snap(preset.threshold),
      thresholdMax: preset.thresholdMax != null ? snap(preset.thresholdMax) : high,
      soundType: preset.tab === 'geiger' ? geigerSoundType : defaultSoundType,
      messageTemplate: getDefaultMessageTemplate(controlId, batteryConfig),
      repeatEverySeconds: null,
      beepCount: ALERT_BEEP_COUNT_DEFAULT,
    }
  }

  return {
    tab: 'single' as AlertTab,
    threshold: snap((dialConfig.min + dialConfig.max) / 2),
    thresholdMax: high,
    soundType: defaultSoundType,
    messageTemplate: getDefaultMessageTemplate(controlId, batteryConfig),
    repeatEverySeconds: null,
    beepCount: ALERT_BEEP_COUNT_DEFAULT,
  }
}

export function AlertFormModal({
  visible,
  controlId,
  unit,
  editRule,
  batteryConfig,
  onClose,
  onSave,
}: AlertFormModalProps) {
  const isEditing = editRule != null
  const dialConfig = useMemo(
    () => getAlertDialConfig(controlId, batteryConfig),
    [controlId, batteryConfig],
  )

  const singlePresets = useMemo(() => getPresetsForCategory('single'), [])
  const geigerPresets = useMemo(() => getPresetsForCategory('geiger'), [])
  const defaultSoundType: AlertSoundType = singlePresets[0]?.uri ?? 'preset:beep'
  const geigerDefaultSoundType: AlertSoundType = geigerPresets[0]?.uri ?? 'preset:beep'

  const [tab, setTab] = useState<AlertTab>('single')
  const [threshold, setThreshold] = useState(dialConfig.min)
  const [thresholdMax, setThresholdMax] = useState(dialConfig.max)
  const [soundType, setSoundType] = useState<AlertSoundType>(defaultSoundType)
  const [messageTemplate, setMessageTemplate] = useState(
    getDefaultMessageTemplate(controlId, batteryConfig),
  )
  const [repeatEverySeconds, setRepeatEverySeconds] = useState<number | null>(null)
  const [beepCount, setBeepCount] = useState(ALERT_BEEP_COUNT_DEFAULT)
  const [prevVisible, setPrevVisible] = useState(visible)

  if (visible && !prevVisible) {
    const defaults = editRule
      ? getEditFormDefaults(editRule, dialConfig, batteryConfig)
      : getNewFormDefaults(
          dialConfig,
          defaultSoundType,
          geigerDefaultSoundType,
          controlId,
          batteryConfig,
        )
    setTab(defaults.tab)
    setThreshold(defaults.threshold)
    setThresholdMax(defaults.thresholdMax)
    setSoundType(defaults.soundType)
    setMessageTemplate(defaults.messageTemplate)
    setRepeatEverySeconds(defaults.repeatEverySeconds)
    setBeepCount(defaults.beepCount)
  }
  if (visible !== prevVisible) {
    setPrevVisible(visible)
  }

  const handleTabSwitch = useCallback(
    (next: AlertTab) => {
      setTab(next)
      if (next === 'message') {
        setMessageTemplate(getDefaultMessageTemplate(controlId, batteryConfig))
      } else {
        const presets = next === 'single' ? singlePresets : geigerPresets
        setSoundType(presets[0]?.uri ?? 'preset:beep')
      }
    },
    [singlePresets, geigerPresets, controlId, batteryConfig],
  )

  const handleSave = useCallback(() => {
    const isRange = tab === 'geiger'
    onSave({
      threshold,
      thresholdMax: isRange ? thresholdMax : null,
      soundType: tab === 'message' ? `tts:${messageTemplate}` : soundType,
      // A range rule's cadence follows range depth, and text-to-speech speaks once per
      // announcement — neither has a beep count or a repeat interval to honor.
      repeatEverySeconds: isRange ? null : repeatEverySeconds,
      beepCount,
    })
  }, [
    tab,
    threshold,
    thresholdMax,
    soundType,
    messageTemplate,
    repeatEverySeconds,
    beepCount,
    onSave,
  ])

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modal}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.modalContent}
          >
            <Text style={styles.modalTitle}>{isEditing ? 'Edit Alert' : 'Add Alert'}</Text>

            <View style={styles.tabRow}>
              <TouchableOpacity
                style={[styles.tab, tab === 'single' && styles.tabActive]}
                onPress={() => handleTabSwitch('single')}
              >
                <WaveformIcon
                  size={14}
                  color={
                    tab === 'single'
                      ? theme.palette.slate.textPrimary
                      : theme.palette.slate.textMuted
                  }
                  weight="fill"
                />
                <Text style={[styles.tabText, tab === 'single' && styles.tabTextActive]}>
                  Alert
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, tab === 'geiger' && styles.tabActive]}
                onPress={() => handleTabSwitch('geiger')}
              >
                <RadioactiveIcon
                  size={14}
                  color={
                    tab === 'geiger'
                      ? theme.palette.slate.textPrimary
                      : theme.palette.slate.textMuted
                  }
                  weight="fill"
                />
                <Text style={[styles.tabText, tab === 'geiger' && styles.tabTextActive]}>
                  Geiger
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, tab === 'message' && styles.tabActive]}
                onPress={() => handleTabSwitch('message')}
              >
                <ChatTextIcon
                  size={14}
                  color={
                    tab === 'message'
                      ? theme.palette.slate.textPrimary
                      : theme.palette.slate.textMuted
                  }
                  weight="fill"
                />
                <Text style={[styles.tabText, tab === 'message' && styles.tabTextActive]}>
                  Message
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.dialField}>
              <Text style={styles.fieldLabel}>THRESHOLD</Text>
              <TuneDial
                value={threshold}
                previousValue={editRule?.threshold ?? undefined}
                min={dialConfig.min}
                max={dialConfig.max}
                step={dialConfig.step}
                unit={dialConfig.unit}
                indicatorGlow={tab === 'geiger' ? 'right' : undefined}
                valueChangeMode="commit"
                onValueChange={setThreshold}
              />
            </View>

            {tab === 'geiger' && (
              <View style={styles.dialField}>
                <Text style={styles.fieldLabel}>THRESHOLD MAX</Text>
                <TuneDial
                  value={thresholdMax}
                  previousValue={editRule?.thresholdMax ?? undefined}
                  min={dialConfig.min}
                  max={dialConfig.max}
                  step={dialConfig.step}
                  unit={dialConfig.unit}
                  indicatorGlow="left"
                  valueChangeMode="commit"
                  onValueChange={setThresholdMax}
                />
              </View>
            )}

            {tab !== 'geiger' && (
              <RepeatField value={repeatEverySeconds} onChange={setRepeatEverySeconds} />
            )}

            {tab === 'single' && (
              <View style={styles.dialField}>
                <Text style={styles.fieldLabel}>BEEPS</Text>
                <Stepper
                  value={beepCount}
                  min={ALERT_BEEP_COUNT_RANGE.min}
                  max={ALERT_BEEP_COUNT_RANGE.max}
                  onChange={setBeepCount}
                  fullWidth
                />
              </View>
            )}

            {tab === 'message' ? (
              <View style={styles.messageField}>
                <Text style={styles.fieldLabel}>TEMPLATE</Text>
                <Input
                  value={messageTemplate}
                  onChangeText={setMessageTemplate}
                  multiline
                  placeholder="e.g. Speed {value} {unit}"
                  placeholderTextColor={theme.palette.slate.textDim}
                  style={styles.templateInput}
                />
                <View style={styles.placeholderRow}>
                  {getMessagePlaceholders(controlId, batteryConfig).map((ph) => (
                    <TouchableOpacity
                      key={ph}
                      style={styles.placeholderChip}
                      onPress={() => setMessageTemplate((t) => t + ph)}
                    >
                      <Text style={styles.placeholderChipText}>{ph}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  style={styles.previewButton}
                  onPress={() =>
                    previewAlertSound(
                      `tts:${renderPreviewTemplate(messageTemplate, threshold, unit, dialConfig, controlId, batteryConfig)}`,
                    )
                  }
                >
                  <Text style={styles.previewButtonText}>Preview</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <SoundPicker
                presets={tab === 'single' ? singlePresets : geigerPresets}
                selected={soundType}
                onSelect={setSoundType}
              />
            )}

            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Text style={styles.saveButtonText}>{isEditing ? 'Save' : 'Add'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

/** Repeat cadence for a single-threshold rule; `Off` is the one-shot choice. */
function RepeatField({
  value,
  onChange,
}: {
  value: number | null
  onChange: (next: number | null) => void
}) {
  return (
    <View style={styles.dialField}>
      <Text style={styles.fieldLabel}>REPEAT</Text>
      <View style={styles.choiceRow}>
        <ChoiceButton label="Off" active={value == null} onPress={() => onChange(null)} />
        {REPEAT_INTERVAL_CHOICES.map((seconds) => (
          <ChoiceButton
            key={seconds}
            label={`${seconds}s`}
            active={value === seconds}
            onPress={() => onChange(seconds)}
          />
        ))}
      </View>
      <Text style={styles.fieldHint}>
        {value == null
          ? 'Announces once, then again only after it drops back down'
          : `Keeps announcing every ${value}s while past the threshold`}
      </Text>
    </View>
  )
}

function ChoiceButton({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity style={[styles.choice, active && styles.choiceActive]} onPress={onPress}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.6),
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    width: '100%',
    maxWidth: 340,
    maxHeight: '90%',
  },
  modalContent: {
    padding: 20,
    gap: 14,
  },
  modalTitle: {
    color: theme.palette.slate.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  tabRow: {
    flexDirection: 'row',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.palette.slate.surface,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  tabActive: {
    backgroundColor: theme.palette.sky.bg,
  },
  tabText: {
    color: theme.palette.slate.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: theme.palette.slate.textPrimary,
  },
  dialField: {
    gap: 6,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 6,
  },
  choice: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  choiceActive: {
    backgroundColor: theme.palette.sky.bg,
  },
  choiceText: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  choiceTextActive: {
    color: theme.palette.slate.textPrimary,
  },
  fieldHint: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  fieldLabel: {
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  saveButton: {
    backgroundColor: theme.palette.sky.color,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  saveButtonText: {
    color: theme.palette.sky.bg,
    fontSize: 15,
    fontWeight: '700',
  },
  messageField: {
    gap: 8,
  },
  templateInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  placeholderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  placeholderChip: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  placeholderChipText: {
    color: theme.palette.slate.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  previewButton: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  previewButtonText: {
    color: theme.palette.slate.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
})
