import { useCallback, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { ChatTextIcon, RadioactiveIcon, SpeakerHighIcon, WaveformIcon } from 'phosphor-react-native'
import { ALERT_BEEP_COUNT_DEFAULT, ALERT_BEEP_COUNT_RANGE, type AlertSoundType } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { PillSelector, PillSelectorItem } from '@/components/controls/PillSelector'
import { SoundPicker } from '@/components/forms/SoundPicker'
import { Stepper } from '@/components/forms/Stepper'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { theme } from '@/constants/theme'
import { AlertMessageField } from '@/modules/alerts/components/AlertMessageField'
import { RepeatField } from '@/modules/alerts/components/AlertFormFields'
import {
  getAlertDialConfig,
  getDefaultMessageTemplate,
  getEditFormDefaults,
  getNewFormDefaults,
  getPresetsForCategory,
} from '@/modules/alerts/lib/alertFormDefaults'
import type { AlertRuleDraft } from '@/modules/alerts/store/alertsStore'
import type { DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'
import type { DerivedBatteryConfig } from '@/modules/battery/lib/types'
import type { TelemetryAlertTab as AlertTab } from '@/modules/board/constants/telemetryThresholds'
import { TuneDial } from '@/modules/tune/components/TuneDial'

interface AlertFormSheetProps {
  visible: boolean
  triggerRef: React.RefObject<View | null>
  controlId: string
  unit: string
  editRule: DraftAlertRule | null
  batteryConfig: DerivedBatteryConfig | null
  onClose(): void
  onSave(draft: AlertRuleDraft): void
}

/** Writes one alert rule: its threshold, how it sounds, and how often it repeats. */
export function AlertFormSheet({
  visible,
  triggerRef,
  controlId,
  unit,
  editRule,
  batteryConfig,
  onClose,
  onSave,
}: AlertFormSheetProps) {
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
    <EdgeDrawer
      visible={visible}
      triggerRef={triggerRef}
      title={isEditing ? 'Edit Alert' : 'Add Alert'}
      icon={tab === 'geiger' ? RadioactiveIcon : tab === 'message' ? ChatTextIcon : WaveformIcon}
      onClose={onClose}
    >
      <PillSelector
        activeId={tab}
        contained
        centered
        variant="lightTabs"
        contentContainerStyle={styles.tabsContent}
      >
        <PillSelectorItem
          id="single"
          label="Alert"
          icon={WaveformIcon}
          labelBehavior="always"
          color={theme.palette.green}
          onPress={() => handleTabSwitch('single')}
        />
        <PillSelectorItem
          id="geiger"
          label="Geiger"
          icon={RadioactiveIcon}
          labelBehavior="always"
          color={theme.palette.orange}
          onPress={() => handleTabSwitch('geiger')}
        />
        <PillSelectorItem
          id="message"
          label="Message"
          icon={ChatTextIcon}
          labelBehavior="always"
          color={theme.palette.cyan}
          onPress={() => handleTabSwitch('message')}
        />
      </PillSelector>

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

      <Button
        label={isEditing ? 'Save' : 'Add alert'}
        icon={SpeakerHighIcon}
        variant="accent"
        onPress={handleSave}
        style={styles.saveButton}
      />
    </EdgeDrawer>
  )
}

const styles = StyleSheet.create({
  tabsContent: {
    paddingHorizontal: 4,
  },
  dialField: {
    gap: 6,
  },
  fieldLabel: {
    color: theme.neutral.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  saveButton: {
    marginTop: 4,
  },
})
