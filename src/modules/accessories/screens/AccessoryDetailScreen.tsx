import { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { IconHero } from '@/components/settings/IconHero'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { AccessoryCapabilityRow } from '@/modules/accessories/components/AccessoryCapabilityRow'
import { AccessoryCompatibilityNotice } from '@/modules/accessories/components/AccessoryCompatibilityNotice'
import { AccessoryIcon } from '@/modules/accessories/constants/accessoryIcon'
import { accessoryStatusCopy, linkErrorCopy } from '@/modules/accessories/lib/accessoryStatus'
import { useAccessoryStore, useSavedAccessory } from '@/modules/accessories/store/accessoryStore'
import { fmtTimeAgo } from '@/helpers/format'
import { theme } from '@/constants/theme'

/**
 * One Accessory's configuration screen: who it says it is, whether Vescape can drive it, what it
 * offers, and where its link stands right now.
 *
 * Identity first, because everything saved about an Accessory keys on it. Per-capability setup —
 * clearance calibration, brake-light behaviour — lives behind each capability in its own slice;
 * this screen is the place they hang off, and the place that says plainly when they cannot. A
 * capability row is a way in only when this build has a screen for that type: ground clearance
 * opens calibration, brake light opens controls and parked preview.
 *
 * Every fact here is native's. The link phase is the one a native session is actually in, which is
 * running whether or not this screen was ever opened.
 */
export function AccessoryDetailScreen({
  accessoryId,
  onForgotten,
  onConfigureCapability,
}: {
  accessoryId: string
  /** Called once the Accessory is gone, so the route that opened this can leave. */
  onForgotten?: () => void
  /** Open one capability's own configuration. Only offered for types this build can configure. */
  onConfigureCapability?: (capabilityId: string, type: string) => void
}) {
  const accessory = useSavedAccessory(accessoryId)
  const forget = useAccessoryStore((s) => s.forget)
  const [forgetting, setForgetting] = useState(false)
  const [forgetFailed, setForgetFailed] = useState(false)

  const onForget = useCallback(async () => {
    setForgetting(true)
    setForgetFailed(false)
    try {
      // Native answers false when the saved identity is still there — a storage failure means the
      // Accessory is still enrolled and still connecting, so leaving the screen would claim
      // something that did not happen.
      if (await forget(accessoryId)) {
        onForgotten?.()
        return
      }
      setForgetFailed(true)
    } finally {
      setForgetting(false)
    }
  }, [accessoryId, forget, onForgotten])

  if (!accessory) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <IconHero
          icon={AccessoryIcon}
          title="Accessory not found"
          description="This accessory is not saved on this phone. Add it again from the Board selector."
        />
      </SafeAreaView>
    )
  }

  const status = accessoryStatusCopy(accessory.phase)

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero icon={AccessoryIcon} title={accessory.name} />

        {accessory.compatibility ? (
          <AccessoryCompatibilityNotice
            compatibility={accessory.compatibility}
            supportedVersions={[]}
          />
        ) : null}

        {accessory.capabilitiesChanged ? (
          <Text style={styles.warning}>
            This accessory now declares different limits than when it was added. Anything calibrated
            against the old ones needs checking before it drives the board again.
          </Text>
        ) : null}

        <SettingsSectionTitle>Connection</SettingsSectionTitle>
        <View style={styles.card}>
          <Fact label="Status" value={status.label} />
          {accessory.error ? (
            <Fact label="Last problem" value={linkErrorCopy(accessory.error)} />
          ) : null}
          <Fact
            label="Last connected"
            value={
              accessory.lastConnectedAt == null ? 'Not yet' : fmtTimeAgo(accessory.lastConnectedAt)
            }
          />
        </View>

        <SettingsSectionTitle>Identity</SettingsSectionTitle>
        <View style={styles.card}>
          <Fact label="Accessory ID" value={accessory.accessoryId} mono />
          <Fact label="Firmware" value={accessory.firmwareVersion} />
          <Fact
            label="Protocol"
            value={
              accessory.protocolVersion == null
                ? 'No common version'
                : `v${accessory.protocolVersion}`
            }
          />
          <Fact label="Added" value={fmtTimeAgo(accessory.enrolledAt)} />
        </View>

        <SettingsSectionTitle>Capabilities</SettingsSectionTitle>
        <View style={styles.card}>
          {accessory.capabilities.length === 0 ? (
            <Text style={styles.empty}>This accessory declared no capabilities.</Text>
          ) : (
            accessory.capabilities.map((capability) => (
              <AccessoryCapabilityRow
                key={capability.id}
                capability={capability}
                phase={accessory.phase}
                {...(capability.supported &&
                (capability.type === 'ground_clearance' || capability.type === 'brake_light')
                  ? { onPress: () => onConfigureCapability?.(capability.id, capability.type) }
                  : {})}
              />
            ))
          )}
        </View>

        <Button
          label="Forget accessory"
          variant="destructive"
          onPress={onForget}
          loading={forgetting}
          testID="accessory-forget"
        />

        {forgetFailed ? (
          <Text style={styles.warning}>
            This accessory could not be removed. It is still saved and still connecting; try again.
          </Text>
        ) : null}

        <Text style={styles.footnote}>
          Vescape connects to a saved accessory on its own, including with the app closed.
          Forgetting it ends that and removes everything saved about it.
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, mono && styles.factValueMono]} numberOfLines={1}>
        {value}
      </Text>
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
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  factLabel: { color: theme.neutral.textMuted, fontSize: 12, fontWeight: '600' },
  factValue: { flexShrink: 1, color: theme.neutral.textSecondary, fontSize: 12 },
  factValueMono: { fontFamily: theme.mono('600'), fontSize: 11 },
  warning: {
    color: theme.status.caution.text,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 4,
  },
  empty: {
    color: theme.neutral.textDim,
    fontSize: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  footnote: {
    color: theme.neutral.textDim,
    fontSize: 11,
    lineHeight: 16,
    paddingHorizontal: 4,
    paddingTop: 4,
  },
})
