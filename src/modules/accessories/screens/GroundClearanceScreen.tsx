import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ArrowsVerticalIcon } from 'phosphor-react-native'
import {
  clearGroundClearanceCalibration,
  saveGroundClearanceCalibration,
  type GroundClearanceDirection,
} from 'vescape-core'

import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { Stepper } from '@/components/forms/Stepper'
import { SegmentedToggle } from '@/components/controls/SegmentedToggle'
import { IconHero } from '@/components/settings/IconHero'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { GroundClearanceReadout } from '@/modules/accessories/components/GroundClearanceReadout'
import { useGroundClearancePreview } from '@/modules/accessories/hooks/useGroundClearancePreview'
import {
  calibrationProblemCopy,
  directionCopy,
} from '@/modules/accessories/lib/groundClearanceCopy'
import { accessoryStatusCopy } from '@/modules/accessories/lib/accessoryStatus'
import { useSavedAccessory } from '@/modules/accessories/store/accessoryStore'
import { theme } from '@/constants/theme'

/** Starting point for a rider who has never calibrated this sensor. Deliberately conservative. */
const DEFAULT_NEAR_CM = 5
const DEFAULT_FAR_CM = 20
const DEFAULT_STRENGTH_PERCENT = 50

/** How long the rider has to stop moving a stepper before the calibration is offered to native. */
const SAVE_DEBOUNCE_MS = 400

interface Draft {
  nearCm: number
  farCm: number
  direction: GroundClearanceDirection
  strengthPercent: number
}

/**
 * Live ground clearance for one capability, and the calibration that turns it into a tilt binding.
 *
 * Two halves, both of them native's. The reading is one sample native accepted, range-checked
 * against what the accessory declares and carrying an explicit status — never a blank filled in
 * with the last good number. The calibration is offered as the rider edits it and native decides
 * whether it is complete; there is no Save button, and what comes back is either "saved" or the
 * rule it broke.
 *
 * Opening this screen is what makes the sensor measure. The demand is released on unmount and on
 * backgrounding, and the accessory stops its continuous measurement while its BLE session stays up
 * — so a rider who wandered off this screen is not quietly draining an accessory battery.
 */
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

  const reading = useGroundClearancePreview(accessoryId, capability ? capabilityId : undefined)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Native's saved calibration seeds the editor once, and only once native has actually said what
  // this capability is. Seeding before the first snapshot lands would fill the steppers with
  // defaults and then refuse the rider's real calibration a frame later, because `current` is set.
  //
  // After the first seed the rider owns the fields: taking every push would yank a stepper back
  // under their thumb the moment a save round-trips.
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
    },
    [],
  )

  const edit = useCallback(
    (patch: Partial<Draft>) => {
      setDraft((current) => {
        if (!current) return current
        const next = { ...current, ...patch }
        if (timer.current) clearTimeout(timer.current)
        // Debounced, because a stepper held down would otherwise write a row per tap. Native still
        // decides validity — this only decides how often it is asked.
        timer.current = setTimeout(() => {
          void saveGroundClearanceCalibration(accessoryId, capabilityId, next).then((result) => {
            setProblem(result.saved ? null : (result.problem ?? null))
          })
        }, SAVE_DEBOUNCE_MS)
        return next
      })
    },
    [accessoryId, capabilityId],
  )

  const onClear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    void clearGroundClearanceCalibration(accessoryId, capabilityId)
    setProblem(null)
    setDraft({
      nearCm: DEFAULT_NEAR_CM,
      farCm: DEFAULT_FAR_CM,
      direction: 'nose',
      strengthPercent: DEFAULT_STRENGTH_PERCENT,
    })
  }, [accessoryId, capabilityId])

  if (!accessory || !capability) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <IconHero
          icon={ArrowsVerticalIcon}
          title="Sensor not found"
          description="This accessory no longer offers a ground-clearance sensor on this phone. Open it from the Board selector to see what it does offer."
        />
      </SafeAreaView>
    )
  }

  const status = accessoryStatusCopy(accessory.phase)
  // The saved calibration's own verdict, re-decided natively against the live manifest, outranks
  // the last save's answer: a firmware that narrowed its range invalidates a calibration nobody
  // touched, and the rider needs to hear that before they hear nothing at all.
  const blocking = saved?.problem ?? problem
  const configured = saved != null && saved.problem == null

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <IconHero
          icon={ArrowsVerticalIcon}
          title="Ground clearance"
          description={`${accessory.name} · ${status.label}`}
        />

        <GroundClearanceReadout
          status={reading?.status ?? null}
          valueCm={reading?.valueCm ?? null}
          measuring={capability.measuring === true}
        />

        {!configured ? (
          <Text style={styles.explainer}>
            This sensor is not set up yet. Mount it on the board, watch the live distance above, and
            set the two distances below: the far one is where correction starts, the near one is
            where it is at full strength. It saves on its own once both are set and the board can
            measure them.
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
            <View style={styles.card}>
              <Field
                label="Far"
                hint="Correction starts here. Above it, nothing is commanded."
                control={
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
              <Field
                label="Near"
                hint="Full strength here. Always smaller than the far distance."
                control={
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
            </View>

            <SettingsSectionTitle>Mounting</SettingsSectionTitle>
            <View style={styles.card}>
              <View style={styles.fieldColumn}>
                <SegmentedToggle
                  options={[
                    { value: 'nose', label: 'Nose' },
                    { value: 'tail', label: 'Tail' },
                  ]}
                  value={draft.direction}
                  onChange={(direction) => edit({ direction })}
                  testID="ground-clearance-direction"
                />
                <Text style={styles.hint}>{directionCopy(draft.direction)}</Text>
              </View>
              <Field
                label="Strength"
                hint="The most Remote Tilt this sensor may command, at the near distance."
                control={
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
            </View>
          </>
        ) : null}

        {configured ? (
          <Button label="Clear calibration" variant="destructive" onPress={onClear} />
        ) : null}

        <Text style={styles.footnote}>
          Calibration belongs to this sensor in this mounting position. Moving it to another board,
          or to the other end of this one, means setting these again. Sensor-driven tilt only runs
          while you are riding — this screen measures on a parked board so you can set it up, and
          commands nothing.
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

function Field({
  label,
  hint,
  control,
}: {
  label: string
  hint: string
  control: React.ReactNode
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldText}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      {control}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 8, paddingBottom: 40 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.neutral.surface,
    overflow: 'hidden',
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  fieldColumn: { gap: 8, paddingHorizontal: 14, paddingVertical: 11 },
  fieldText: { flexShrink: 1, gap: 2 },
  fieldLabel: { color: theme.neutral.textPrimary, fontSize: 14, fontWeight: '700' },
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
  footnote: {
    color: theme.neutral.textDim,
    fontSize: 11,
    lineHeight: 16,
    paddingHorizontal: 4,
    paddingTop: 4,
  },
})
