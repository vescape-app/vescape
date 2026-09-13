import { useEffect, useRef, useState } from 'react'
import { AppState, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LightbulbFilamentIcon } from 'phosphor-react-native'
import {
  saveBrakeLightSettings,
  setBrakeLightPreview,
  type BrakeLightSettings,
  type BrakeLightMode,
} from 'vescape-core'

import { Text } from '@/components/base/Text'
import { Stepper } from '@/components/forms/Stepper'
import { SegmentedToggle } from '@/components/controls/SegmentedToggle'
import { IconHero } from '@/components/settings/IconHero'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { BrakeLightStates } from '@/modules/accessories/components/BrakeLightStates'
import { CapabilityEnabledControl } from '@/modules/accessories/components/CapabilityEnabledControl'
import { useSavedAccessory } from '@/modules/accessories/store/accessoryStore'
import { accessoryStatusCopy } from '@/modules/accessories/lib/accessoryStatus'
import { theme } from '@/constants/theme'

/**
 * How long a tapped state stays on the light before it is handed back to the Board.
 *
 * Long enough to step behind the board and look at the lamp, short enough that a rider who walked
 * away does not leave the light pinned — native only drops a preview once the board starts moving.
 */
const PREVIEW_SECONDS = 10

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
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
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

  // Native owns whether a preview is up — riding ends one without asking this screen. The countdown
  // follows that fact rather than the tap that started it, so a preview native dropped stops
  // counting down here too.
  const held = capability?.lightPreview ?? null
  useEffect(() => {
    if (!held) {
      setSecondsLeft(null)
      return
    }
    setSecondsLeft(PREVIEW_SECONDS)
    const timer = setInterval(() => {
      setSecondsLeft((current) => {
        if (current == null) return null
        if (current > 1) return current - 1
        void setBrakeLightPreview(accessoryId, capabilityId, null)
        return null
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [held, accessoryId, capabilityId])

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
          iconColor={theme.palette.red.color}
          title="Brake light"
          description="Follows the current Board. Settings save automatically for this light."
        />
        {!accessory || !capability || !draft ? (
          <Text style={styles.hint}>Brake light not available.</Text>
        ) : (
          <>
            <CapabilityEnabledControl
              accessoryId={accessoryId}
              capability={capability}
              accent={theme.palette.red.color}
            />
            <View style={styles.statusLine}>
              <Text style={styles.hint}>{accessory.name}</Text>
              <Text style={styles.hint}>{accessoryStatusCopy(accessory.phase).label}</Text>
            </View>

            <SettingsSectionTitle>Light states</SettingsSectionTitle>
            <BrakeLightStates
              activeMode={capability.lightPreview ?? capability.lightMode ?? null}
              previewMode={capability.lightPreview ?? null}
              parked={draft.parked}
              previewSecondsLeft={secondsLeft}
              disabled={accessory.phase !== 'connected' || capability.enabled === false}
              onPreview={preview}
            />
            <Text style={styles.hint}>
              The lit tile is what the app is asking the light for; the protocol never reports the
              lamp back. Tap one to hold it for {PREVIEW_SECONDS} seconds and check the light itself
              — riding hands it straight back to the Board.
            </Text>

            <SettingsSectionTitle>Behaviour</SettingsSectionTitle>
            <SettingsCard>
              <SettingsRow
                icon={LightbulbFilamentIcon}
                iconColor={theme.palette.red.color}
                label="Sensitivity"
                hint="Higher reacts to gentler slowing, in either direction."
                right={
                  <Stepper
                    value={draft.sensitivity}
                    unit="%"
                    min={1}
                    max={100}
                    step={5}
                    onChange={(sensitivity) => edit({ sensitivity })}
                    testIDPrefix="brake-light-sensitivity"
                  />
                }
              />
              <SettingsRow
                icon={LightbulbFilamentIcon}
                iconColor={theme.neutral.textSecondary}
                iconWeight="regular"
                label="While parked"
                hint="What the light does once the Board stops."
              >
                <View style={styles.rowControl}>
                  <SegmentedToggle
                    options={[
                      { value: 'off', label: 'Off' },
                      { value: 'glow', label: 'Glow' },
                    ]}
                    value={draft.parked}
                    onChange={(parked) => edit({ parked })}
                    accent={theme.palette.red.color}
                    variant="secondary"
                    testID="brake-light-parked"
                  />
                </View>
              </SettingsRow>
            </SettingsCard>

            {problem ? <Text style={styles.problem}>{problem}</Text> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 10, paddingBottom: 40 },
  statusLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 4,
  },
  hint: { color: theme.neutral.textMuted, fontSize: 12, lineHeight: 16 },
  rowControl: { paddingHorizontal: 14, paddingBottom: 14 },
  problem: { color: theme.palette.red.color, fontSize: 12 },
})
