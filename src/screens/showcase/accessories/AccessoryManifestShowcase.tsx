import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type {
  AccessoryCapability,
  AccessoryCompatibility,
  AccessoryReadingStatus,
} from 'vescape-core'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { AccessoryCapabilityRow } from '@/modules/accessories/components/AccessoryCapabilityRow'
import { AccessoryCompatibilityNotice } from '@/modules/accessories/components/AccessoryCompatibilityNotice'
import { GroundClearanceReadout } from '@/modules/accessories/components/GroundClearanceReadout'
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
    calibration: { nearCm: 5, farCm: 20, direction: 'nose', strengthPercent: 60, problem: null },
    measuring: true,
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
  const [navigable, setNavigable] = useState(true)

  return (
    <ShowcaseCard
      name="AccessoryCapabilityRow"
      controls={
        <ToggleRow
          label="ground clearance opens its setup"
          value={navigable}
          onToggle={setNavigable}
        />
      }
    >
      <View style={styles.card}>
        {CAPABILITIES.map((capability) => (
          <AccessoryCapabilityRow
            key={capability.id}
            capability={capability}
            // Only a capability this build can configure gets a chevron. Everything else stays a
            // flat row rather than a tap that leads somewhere empty.
            {...(navigable && capability.supported && capability.type === 'ground_clearance'
              ? { onPress: () => {} }
              : {})}
          />
        ))}
      </View>
    </ShowcaseCard>
  )
}

const READING_STATES: {
  label: string
  status: AccessoryReadingStatus | null
  valueCm: number | null
  measuring: boolean
}[] = [
  { label: 'measuring', status: 'ok', valueCm: 12.4, measuring: true },
  { label: 'nothing in range', status: 'out_of_range', valueCm: null, measuring: true },
  { label: 'sensor error', status: 'error', valueCm: null, measuring: true },
  { label: 'waiting', status: null, valueCm: null, measuring: true },
  { label: 'standby', status: null, valueCm: null, measuring: false },
]

export function GroundClearanceReadoutShowcase() {
  const [index, setIndex] = useState(0)
  const state = READING_STATES[index] ?? READING_STATES[0]!

  return (
    <ShowcaseCard
      name="GroundClearanceReadout"
      controls={
        <ChipRow
          label="reading"
          options={READING_STATES.map((entry) => entry.label)}
          selected={state.label}
          onSelect={(next) => setIndex(READING_STATES.findIndex((entry) => entry.label === next))}
        />
      }
    >
      <View style={styles.stack}>
        <GroundClearanceReadout
          status={state.status}
          valueCm={state.valueCm}
          measuring={state.measuring}
        />
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
