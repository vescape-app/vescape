import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type { AccessoryCapability, AccessoryCompatibility } from 'vescape-core'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow } from '@/components/dev/ShowcaseControls'
import { AccessoryCapabilityRow } from '@/modules/accessories/components/AccessoryCapabilityRow'
import { AccessoryCompatibilityNotice } from '@/modules/accessories/components/AccessoryCompatibilityNotice'
import { theme } from '@/constants/theme'

const COMPATIBILITIES: AccessoryCompatibility[] = [
  'supported',
  'unsupported-version',
  'unsupported-capabilities',
]

const CAPABILITIES: AccessoryCapability[] = [
  {
    id: 'clearance',
    type: 'ground_clearance',
    supported: true,
    unit: 'cm',
    rangeMin: 3,
    rangeMax: 100,
    ratesHz: [10, 20, 30],
  },
  {
    id: 'rear_light',
    type: 'brake_light',
    supported: true,
    unit: null,
    rangeMin: null,
    rangeMax: null,
    ratesHz: [],
  },
  // An accessory ahead of the app: named by its wire slug rather than hidden.
  {
    id: 'horn',
    type: 'air_horn',
    supported: false,
    unit: null,
    rangeMin: null,
    rangeMax: null,
    ratesHz: [],
  },
  // A recognized type the app still cannot drive: the unit is not the one v1 defines.
  {
    id: 'clearance_mm',
    type: 'ground_clearance',
    supported: false,
    unit: 'mm',
    rangeMin: 30,
    rangeMax: 1000,
    ratesHz: [10],
  },
]

export function AccessoryCompatibilityNoticeShowcase() {
  const [compatibility, setCompatibility] = useState<AccessoryCompatibility>('supported')

  return (
    <ShowcaseCard
      name="AccessoryCompatibilityNotice"
      controls={
        <ChipRow
          label="compatibility"
          options={COMPATIBILITIES}
          selected={compatibility}
          onSelect={(next) => setCompatibility(next as AccessoryCompatibility)}
        />
      }
    >
      <View style={styles.stack}>
        <AccessoryCompatibilityNotice
          compatibility={compatibility}
          supportedVersions={compatibility === 'unsupported-version' ? [2, 3] : []}
        />
      </View>
    </ShowcaseCard>
  )
}

export function AccessoryCapabilityRowShowcase() {
  return (
    <ShowcaseCard name="AccessoryCapabilityRow">
      <View style={styles.card}>
        {CAPABILITIES.map((capability) => (
          <AccessoryCapabilityRow key={capability.id} capability={capability} />
        ))}
      </View>
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  stack: { alignSelf: 'stretch', gap: 8 },
  card: {
    alignSelf: 'stretch',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.neutral.surface,
    overflow: 'hidden',
  },
})
