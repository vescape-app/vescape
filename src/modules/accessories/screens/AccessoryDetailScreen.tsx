import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PlugsConnectedIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { IconHero } from '@/components/settings/IconHero'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { AccessoryCapabilityRow } from '@/modules/accessories/components/AccessoryCapabilityRow'
import { AccessoryCompatibilityNotice } from '@/modules/accessories/components/AccessoryCompatibilityNotice'
import { accessoryStatusCopy } from '@/modules/accessories/lib/accessoryStatus'
import {
  accessoryLinkStatus,
  useAccessoryDiscoveryStore,
} from '@/modules/accessories/store/accessoryDiscoveryStore'
import { fmtTimeAgo } from '@/helpers/format'
import { theme } from '@/constants/theme'

/**
 * One Accessory's configuration screen: who it says it is, whether Vescape can drive it, and what
 * it offers.
 *
 * Identity first, because everything saved about an Accessory keys on it. Per-capability setup —
 * clearance calibration, brake-light behaviour — lives behind each capability in its own slice;
 * this screen is the place they hang off, and the place that says plainly when they cannot.
 */
export function AccessoryDetailScreen({ accessoryId }: { accessoryId: string }) {
  const accessory = useAccessoryDiscoveryStore((s) =>
    s.accessories.find((a) => a.accessoryId === accessoryId),
  )
  const devices = useAccessoryDiscoveryStore((s) => s.devices)

  if (!accessory) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <IconHero
          icon={PlugsConnectedIcon}
          title="Accessory not found"
          description="This accessory has not answered yet in this session. Scan for it again from the Board selector."
        />
      </SafeAreaView>
    )
  }

  const { manifest } = accessory
  const status = accessoryLinkStatus(accessory, devices)

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero icon={PlugsConnectedIcon} title={manifest.name} />

        <AccessoryCompatibilityNotice
          compatibility={manifest.compatibility}
          supportedVersions={manifest.supportedVersions}
        />

        <SettingsSectionTitle>Identity</SettingsSectionTitle>
        <View style={styles.card}>
          <Fact label="Accessory ID" value={manifest.accessoryId} mono />
          <Fact label="Firmware" value={manifest.firmwareVersion} />
          <Fact
            label="Protocol"
            value={
              manifest.protocolVersion == null
                ? 'No common version'
                : `v${manifest.protocolVersion}`
            }
          />
          <Fact
            label="Link"
            value={`${accessoryStatusCopy(status).label} · checked ${fmtTimeAgo(accessory.inspectedAt)}`}
          />
        </View>

        <SettingsSectionTitle>Capabilities</SettingsSectionTitle>
        <View style={styles.card}>
          {manifest.capabilities.length === 0 ? (
            <Text style={styles.empty}>This accessory declared no capabilities.</Text>
          ) : (
            manifest.capabilities.map((capability) => (
              <AccessoryCapabilityRow key={capability.id} capability={capability} />
            ))
          )}
        </View>

        <Text style={styles.footnote}>
          Discovery reads this accessory and disconnects. Nothing on it runs until it is set up.
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
