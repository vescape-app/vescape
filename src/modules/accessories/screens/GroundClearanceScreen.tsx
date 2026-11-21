import { PageScrollView } from '@/components/base/PageScrollView'
import { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  ArrowsVerticalIcon,
  CompassIcon,
  PulseIcon,
  SlidersIcon,
} from 'phosphor-react-native'
import {
  saveGroundClearanceCalibration,
  setAccessorySamplingRate,
  type GroundClearanceDirection,
} from 'vescape-core'

import { Text } from '@/components/base/Text'
import { Stepper } from '@/components/forms/Stepper'
import { SegmentedToggle } from '@/components/controls/SegmentedToggle'
import { IconHero } from '@/components/settings/IconHero'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { GroundClearanceTelemetry } from '@/modules/accessories/components/GroundClearanceTelemetry'
import { CapabilityEnabledControl } from '../components/CapabilityEnabledControl'
import {
  calibrationProblemCopy,
  directionCopy,
} from '@/modules/accessories/lib/groundClearanceCopy'
import { useSavedAccessory } from '@/modules/accessories/store/accessoryStore'
import { theme } from '@/constants/theme'

const DEFAULT_NEAR_CM = 5
const DEFAULT_FAR_CM = 20
const DEFAULT_STRENGTH_PERCENT = 50

const SAVE_DEBOUNCE_MS = 400

interface Draft {
  nearCm: number
  farCm: number
  direction: GroundClearanceDirection
  strengthPercent: number
}

export function GroundClearanceScreen({
  accessoryId,
  capabilityId,
}: {
  accessoryId: string
  capabilityId: string
}) {
  const accessory = useSavedAccessory(accessoryId)
  const capability = accessory?.capabilities.find((entry) => entry.id === capabilityId)
  const saved = capability?.calibration ?? null

  const [draft, setDraft] = useState<Draft | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [savingRate, setSavingRate] = useState(false)
  const [rateFailed, setRateFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Draft | null>(null)

  const known = capability != null
  useEffect(() => {
    if (!known) return
    setDraft((current) => {
      if (current) return current
      if (!saved) {
        return {
          nearCm: DEFAULT_NEAR_CM,
          farCm: DEFAULT_FAR_CM,
          direction: 'nose',
          strengthPercent: DEFAULT_STRENGTH_PERCENT,
        }
      }
      return {
        nearCm: saved.nearCm,
        farCm: saved.farCm,
        direction: saved.direction === 'tail' ? 'tail' : 'nose',
        strengthPercent: saved.strengthPercent,
      }
    })
  }, [known, saved])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      const unsaved = pending.current
      pending.current = null
      if (unsaved) {
        void saveGroundClearanceCalibration(accessoryId, capabilityId, unsaved)
      }
    },
    [accessoryId, capabilityId],
  )

  const edit = useCallback(
    (patch: Partial<Draft>) => {
      setDraft((current) => {
        if (!current) return current
        const next = { ...current, ...patch }
        pending.current = next
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          timer.current = null
          pending.current = null
          void saveGroundClearanceCalibration(accessoryId, capabilityId, next).then((result) => {
            setProblem(result.saved ? null : (result.problem ?? null))
          })
        }, SAVE_DEBOUNCE_MS)
        return next
      })
    },
    [accessoryId, capabilityId],
  )

  const changeRate = async (rateHz: number) => {
    setSavingRate(true)
    setRateFailed(false)
    try {
      setRateFailed(!(await setAccessorySamplingRate(accessoryId, capabilityId, rateHz)))
    } catch {
      setRateFailed(true)
    } finally {
      setSavingRate(false)
    }
  }

  if (!accessory || !capability) {
    return (
      <SafeAreaView style={styles.container} edges={[]}>
        <IconHero
          icon={ArrowsVerticalIcon}
          title="Sensor not found"
          description="This accessory no longer offers a ground-clearance sensor on this phone. Open it from the Board selector to see what it does offer."
        />
      </SafeAreaView>
    )
  }

  const blocking = saved?.problem ?? problem
  const configured = saved != null && saved.problem == null

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <PageScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <IconHero
          icon={ArrowsVerticalIcon}
          iconColor={theme.palette.sky.color}
          title="Ground clearance"
          description="Measures how far the board sits above the ground and turns that into Remote Tilt while you ride."
        />
        <CapabilityEnabledControl
          accessoryId={accessoryId}
          capability={capability}
          accent={theme.palette.sky.color}
        />
        <SettingsSectionTitle>Sampling rate</SettingsSectionTitle>
        <SettingsCard>
          <SettingsRow
            icon={PulseIcon}
            iconColor={theme.palette.sky.color}
            label="Rate"
            hint="How often the sensor reports a distance."
            right={
              <Choice
                options={capability.ratesHz.map((rateHz) => ({
                  value: String(rateHz),
                  label: `${rateHz} Hz`,
                }))}
                value={String(capability.selectedRateHz ?? capability.ratesHz[0] ?? '')}
                onChange={(rate) => {
                  void changeRate(Number(rate))
                }}
                disabled={savingRate || !capability.supported}
                testID="ground-clearance-rate"
              />
            }
          />
        </SettingsCard>
        {rateFailed ? (
          <Text style={styles.warning}>Could not save sampling rate. Try again.</Text>
        ) : null}
        {capability.enabled !== false ? (
          <GroundClearanceTelemetry
            accessoryId={accessoryId}
            capabilityId={capabilityId}
            range={{ min: capability.rangeMin ?? 3, max: capability.rangeMax ?? 100 }}
          />
        ) : (
          <Text style={styles.hint}>
            Sensor disabled. Measurements and automatic tilt are stopped.
          </Text>
        )}

        {!configured ? (
          <Text style={styles.explainer}>
            Not set up yet. Watch the live distance above, then set the far and near distances
            below.
          </Text>
        ) : null}

        {blocking ? (
          <Text style={styles.warning} testID="ground-clearance-problem">
            {calibrationProblemCopy(blocking)}
          </Text>
        ) : null}

        {draft ? (
          <>
            <SettingsSectionTitle>Distances</SettingsSectionTitle>
            <SettingsCard>
              <SettingsRow
                icon={ArrowLineUpIcon}
                iconColor={theme.palette.sky.color}
                label="Far"
                hint="Correction starts here."
                right={
                  <Stepper
                    value={draft.farCm}
                    unit="cm"
                    min={capability.rangeMin ?? undefined}
                    max={capability.rangeMax ?? undefined}
                    onChange={(farCm) => edit({ farCm })}
                    testIDPrefix="ground-clearance-far"
                  />
                }
              />
              <SettingsRow
                icon={ArrowLineDownIcon}
                iconColor={theme.palette.sky.color}
                label="Near"
                hint="Full strength here. Always below the far distance."
                right={
                  <Stepper
                    value={draft.nearCm}
                    unit="cm"
                    min={capability.rangeMin ?? undefined}
                    max={capability.rangeMax ?? undefined}
                    onChange={(nearCm) => edit({ nearCm })}
                    testIDPrefix="ground-clearance-near"
                  />
                }
              />
            </SettingsCard>

            <SettingsSectionTitle>Mounting</SettingsSectionTitle>
            <SettingsCard>
              <SettingsRow
                icon={CompassIcon}
                iconColor={theme.neutral.textSecondary}
                label="Mounted at"
                hint={directionCopy(draft.direction)}
                right={
                  <Choice
                    options={[
                      { value: 'nose', label: 'Nose' },
                      { value: 'tail', label: 'Tail' },
                    ]}
                    value={draft.direction}
                    onChange={(direction) => edit({ direction })}
                    testID="ground-clearance-direction"
                  />
                }
              />
              <SettingsRow
                icon={SlidersIcon}
                iconColor={theme.neutral.textSecondary}
                label="Strength"
                hint="The most Remote Tilt this sensor may command."
                right={
                  <Stepper
                    value={draft.strengthPercent}
                    unit="%"
                    min={1}
                    max={100}
                    step={5}
                    onChange={(strengthPercent) => edit({ strengthPercent })}
                    testIDPrefix="ground-clearance-strength"
                  />
                }
              />
            </SettingsCard>
          </>
        ) : null}
      </PageScrollView>
    </SafeAreaView>
  )
}

function Choice<T extends string>({
  options,
  value,
  onChange,
  disabled,
  testID,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  testID: string
}) {
  return (
    <View pointerEvents={disabled ? 'none' : 'auto'} style={disabled ? styles.inert : undefined}>
      <SegmentedToggle
        options={options}
        value={value}
        onChange={onChange}
        variant="secondary"
        testID={testID}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  inert: { opacity: 0.45 },
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 10, paddingBottom: 40 },
  hint: { color: theme.neutral.textSecondary, fontSize: 12, lineHeight: 16 },
  explainer: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 4,
  },
  warning: {
    color: theme.status.caution.text,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 4,
  },
})
