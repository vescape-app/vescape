import { StyleSheet, View } from 'react-native'

import { SectionHeader } from '@/components/base/SectionHeader'
import { AccessoryIcon } from '@/modules/accessories/constants/accessoryIcon'
import { AccessoryRow } from '@/modules/accessories/components/AccessoryRow'
import type { AccessoryLinkPhase } from 'vescape-core'
import { theme } from '@/constants/theme'

export interface AccessorySelectorItem {
  accessoryId: string
  name: string
  detail?: string | undefined
  phase: AccessoryLinkPhase
  needsSetup?: boolean
}

interface AccessorySelectorSectionProps {
  accessories: AccessorySelectorItem[]
  onSelectAccessory: (accessoryId: string) => void
}

/**
 * The Accessories half of the Board selector: its own section, not a branch of any Board.
 *
 * Accessories target whichever Board is connected, so nesting them under one would promise a
 * per-Board binding that does not exist. The section is presentational — the screen composing the
 * selector supplies the list and selection action.
 */
export function AccessorySelectorSection({
  accessories,
  onSelectAccessory,
}: AccessorySelectorSectionProps) {
  if (accessories.length === 0) return null

  return (
    <View style={styles.frame}>
      <SectionHeader
        icon={AccessoryIcon}
        title="Accessories"
        color={theme.palette.sky.color}
        align="center"
      />
      {accessories.map((accessory) => (
        <AccessoryRow
          key={accessory.accessoryId}
          name={accessory.name}
          detail={accessory.detail}
          phase={accessory.phase}
          needsSetup={accessory.needsSetup}
          onPress={() => onSelectAccessory(accessory.accessoryId)}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    gap: 6,
  },
})
