import { useEffect, useRef, useState } from 'react'
import { AppState, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LightbulbFilamentIcon } from 'phosphor-react-native'
import {
  saveBrakeLightSettings,
  setBrakeLightPreview,
  type BrakeLightSettings,
  type BrakeLightMode,
} from 'vescape-core'

import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { Stepper } from '@/components/forms/Stepper'
import { SegmentedToggle } from '@/components/controls/SegmentedToggle'
import { IconHero } from '@/components/settings/IconHero'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { useSavedAccessory } from '@/modules/accessories/store/accessoryStore'
import { accessoryStatusCopy } from '@/modules/accessories/lib/accessoryStatus'
import { theme } from '@/constants/theme'

const previewOptions: { value: BrakeLightMode; label: string }[] = [
  { value: 'riding', label: 'Riding' },
  { value: 'braking', label: 'Braking' },
  { value: 'hard_braking', label: 'Hard braking' },
  { value: 'not_riding', label: 'Parked' },
]

export function BrakeLightScreen({
  accessoryId,
  capabilityId,
}: {
  accessoryId: string
  capabilityId: string
}) {
  const accessory = useSavedAccessory(accessoryId)
  const capability = accessory?.capabilities.find(
    (entry) => entry.id === capabilityId && entry.type === 'brake_light',
  )
  const [draft, setDraft] = useState<BrakeLightSettings | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const latest = useRef<BrakeLightSettings | null>(null)
  const revision = useRef(0)
  const saved = capability?.brakeLight
  useEffect(() => {
    if (!saved || latest.current) return
    latest.current = saved
    setDraft(saved)
  }, [saved])

  useEffect(() => {
    const release = () => {
      void setBrakeLightPreview(accessoryId, capabilityId, null)
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') release()
    })
    return () => {
      subscription.remove()
      release()
    }
  }, [accessoryId, capabilityId])

  const edit = (patch: Partial<BrakeLightSettings>) => {
    if (!latest.current) return
    const next = { ...latest.current, ...patch }
    latest.current = next
    setDraft(next)
    const mutation = ++revision.current
    void saveBrakeLightSettings(accessoryId, capabilityId, next)
      .then((ok) => {
        if (revision.current === mutation)
          setProblem(ok ? null : 'Could not save. Change the setting again to retry.')
      })
      .catch(() => {
        if (revision.current === mutation)
          setProblem('Could not save. Change the setting again to retry.')
      })
  }
  const preview = (mode: BrakeLightMode | null) => {
    void setBrakeLightPreview(accessoryId, capabilityId, mode)
      .then((accepted) => {
        setProblem(accepted ? null : 'Park the Board before starting a preview.')
      })
      .catch(() => setProblem('Preview could not start.'))
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={LightbulbFilamentIcon}
          title="Brake light"
          description="Follows the current Board. Settings save automatically for this light."
        />
        {!accessory || !capability || !draft ? (
          <Text>Brake light not available.</Text>
        ) : (
          <>
            <Text>{accessoryStatusCopy(accessory.phase).label}</Text>
            <SettingsSectionTitle>Sensitivity</SettingsSectionTitle>
            <Stepper
              value={draft.sensitivity}
              min={1}
              max={100}
              step={5}
              onChange={(sensitivity) => edit({ sensitivity })}
            />
            <Text>
              Higher sensitivity reacts to gentler slowing. Braking uses Board speed in either
              direction.
            </Text>
            <SettingsSectionTitle>While parked</SettingsSectionTitle>
            <SegmentedToggle
              options={[
                { value: 'off', label: 'Off' },
                { value: 'glow', label: 'Glow' },
              ]}
              value={draft.parked}
              onChange={(parked) => edit({ parked })}
            />
            <SettingsSectionTitle>Parked preview</SettingsSectionTitle>
            <Text>
              Test each state on the connected accessory. Returning to automatic restores the
              current Board state. Riding ends preview.
            </Text>
            {previewOptions.map(({ value, label }) => (
              <Button
                key={value}
                label={label}
                variant={capability.lightPreview === value ? 'primary' : 'secondary'}
                onPress={() => preview(value)}
                disabled={accessory.phase !== 'connected'}
              />
            ))}
            <Button label="Return to automatic" variant="secondary" onPress={() => preview(null)} />
            <Text>
              {capability.lightPreview ? 'Preview active' : 'Automatic'}. Acknowledged commands
              confirm the accessory accepted the state; check the physical light separately.
            </Text>
            {problem ? <Text style={styles.problem}>{problem}</Text> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  problem: { color: theme.palette.red.color },
})
