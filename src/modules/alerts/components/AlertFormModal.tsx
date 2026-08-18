import { useCallback, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native'
import { ALERT_BEEP_COUNT_DEFAULT, ALERT_BEEP_COUNT_RANGE, type AlertSoundType } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { SoundPicker } from '@/components/forms/SoundPicker'
import { Stepper } from '@/components/forms/Stepper'
import { theme } from '@/constants/theme'
import { AlertFormTabs } from '@/modules/alerts/components/AlertFormTabs'
import { AlertMessageField } from '@/modules/alerts/components/AlertMessageField'
import { RepeatField } from '@/modules/alerts/components/AlertFormFields'
import {
  getAlertDialConfig,
  getDefaultMessageTemplate,
  getEditFormDefaults,
  getNewFormDefaults,
  getPresetsForCategory,
} from '@/modules/alerts/lib/alertFormDefaults'
import { type AlertRuleDraft } from '@/modules/alerts/store/alertsStore'
import { type DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'
import { type DerivedBatteryConfig } from '@/modules/battery/lib/types'
import type { TelemetryAlertTab as AlertTab } from '@/modules/board/constants/telemetryThresholds'
import { TuneDial } from '@/modules/tune/components/TuneDial'

interface AlertFormModalProps {
  visible: boolean
  controlId: string
  unit: string
  editRule: DraftAlertRule | null
  batteryConfig: DerivedBatteryConfig | null
  onClose(): void
  onSave(draft: AlertRuleDraft): void
}

/** Writes one alert rule: its threshold, how it sounds, and how often it repeats. */
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

            <AlertFormTabs tab={tab} onSelect={handleTabSwitch} />

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
              <AlertMessageField
                controlId={controlId}
                unit={unit}
                threshold={threshold}
                dialConfig={dialConfig}
                batteryConfig={batteryConfig}
                messageTemplate={messageTemplate}
                onChangeTemplate={setMessageTemplate}
              />
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
  dialField: {
    gap: 6,
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
})
