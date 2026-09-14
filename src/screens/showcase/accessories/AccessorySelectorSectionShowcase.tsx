import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import {
  AccessorySelectorSection,
  type AccessorySelectorItem,
} from '@/modules/accessories/components/AccessorySelectorSection'
import { theme } from '@/constants/theme'
import type { AccessoryLinkPhase } from 'vescape-core'

const PHASES: AccessoryLinkPhase[] = [
  'connected',
  'connecting',
  'handshaking',
  'unavailable',
  'incompatible',
  'idle',
]

export function AccessorySelectorSectionShowcase() {
  const [phase, setPhase] = useState<AccessoryLinkPhase>('connected')
  const [empty, setEmpty] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [lastAction, setLastAction] = useState('Tap a row to see its action here.')

  const accessories: AccessorySelectorItem[] = empty
    ? []
    : [
        {
          accessoryId: 'clearance-1',
          name: 'Clearance sensor',
          detail: 'v0.1.0',
          phase,
          needsSetup,
        },
        {
          accessoryId: 'light-1',
          name: 'Rear light',
          detail: 'v0.2.1',
          phase: 'connecting',
        },
      ]

  return (
    <ShowcaseCard
      name="AccessorySelectorSection"
      controls={
        <>
          <ChipRow
            label="phase"
            options={PHASES}
            selected={phase}
            onSelect={(next) => setPhase(next as AccessoryLinkPhase)}
          />
          <ToggleRow label="first needs setup" value={needsSetup} onToggle={setNeedsSetup} />
          <ToggleRow label="no accessories yet" value={empty} onToggle={setEmpty} />
        </>
      }
    >
      <View style={styles.sheet}>
        <AccessorySelectorSection
          accessories={accessories}
          onSelectAccessory={(id) => setLastAction(`Open accessory ${id}`)}
          onAddAccessory={() => setLastAction('Add accessory')}
        />
      </View>
      <Text style={styles.action}>{lastAction}</Text>
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  // The drawer the real section lives in, so the rows read at their true width — gap included,
  // since the drawer separates its content and the showcase must not look tighter.
  sheet: {
    alignSelf: 'stretch',
    padding: 12,
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.alpha(theme.neutral.bg, 0.85),
    overflow: 'hidden',
  },
  action: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    paddingTop: 8,
  },
})
