import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import {
  AccessorySelectorSection,
  type AccessorySelectorItem,
} from '@/modules/accessories/components/AccessorySelectorSection'
import type { AccessoryLinkStatus } from '@/modules/accessories/lib/accessoryStatus'
import { theme } from '@/constants/theme'

const STATUSES: AccessoryLinkStatus[] = ['advertising', 'idle', 'unreachable']

export function AccessorySelectorSectionShowcase() {
  const [status, setStatus] = useState<AccessoryLinkStatus>('advertising')
  const [empty, setEmpty] = useState(false)
  const [incompatible, setIncompatible] = useState(false)
  const [lastAction, setLastAction] = useState('Tap a row to see its action here.')

  const accessories: AccessorySelectorItem[] = empty
    ? []
    : [
        {
          accessoryId: 'clearance-1',
          name: 'Clearance sensor',
          detail: 'v0.1.0',
          status,
          incompatible,
        },
        {
          accessoryId: 'light-1',
          name: 'Rear light',
          detail: 'v0.2.1',
          status: 'idle',
        },
      ]

  return (
    <ShowcaseCard
      name="AccessorySelectorSection"
      controls={
        <>
          <ChipRow
            label="status"
            options={STATUSES}
            selected={status}
            onSelect={(next) => setStatus(next as AccessoryLinkStatus)}
          />
          <ToggleRow
            label="first is incompatible"
            value={incompatible}
            onToggle={setIncompatible}
          />
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
  // The drawer the real section lives in, so the rows read at their true width.
  sheet: {
    alignSelf: 'stretch',
    padding: 12,
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
