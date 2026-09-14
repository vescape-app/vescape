import { Pressable, StyleSheet, View } from 'react-native'
import { PlusIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { Placeholder } from '@/components/base/Placeholder'
import { SectionHeader } from '@/components/base/SectionHeader'
import { AccessoryIcon } from '@/modules/accessories/constants/accessoryIcon'
import { AccessoryRow } from '@/modules/accessories/components/AccessoryRow'
import type { AccessoryLinkPhase } from 'vescape-core'
import { interaction, theme } from '@/constants/theme'

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
  onAddAccessory: () => void
}

/**
 * The Accessories half of the Board selector: its own section, not a branch of any Board.
 *
 * Accessories target whichever Board is connected, so nesting them under one would promise a
 * per-Board binding that does not exist. The section is presentational — the screen composing the
 * selector supplies the list and both actions.
 */
export function AccessorySelectorSection({
  accessories,
  onSelectAccessory,
  onAddAccessory,
}: AccessorySelectorSectionProps) {
  return (
    <View style={styles.frame}>
      <SectionHeader
        icon={AccessoryIcon}
        title="Accessories"
        color={theme.palette.sky.color}
        align="center"
      />
      {accessories.length === 0 ? (
        <Placeholder
          icon={AccessoryIcon}
          description="No accessories yet. Add one and Vescape connects to it every ride."
          compact
        />
      ) : (
        accessories.map((accessory) => (
          <AccessoryRow
            key={accessory.accessoryId}
            name={accessory.name}
            detail={accessory.detail}
            phase={accessory.phase}
            needsSetup={accessory.needsSetup}
            onPress={() => onSelectAccessory(accessory.accessoryId)}
          />
        ))
      )}

      <Pressable
        style={({ pressed }) => [styles.addRow, pressed && styles.rowPressed]}
        onPress={onAddAccessory}
        testID="board-selector-add-accessory"
        accessibilityRole="button"
        accessibilityLabel="Add accessory"
      >
        <View style={styles.addIcon}>
          <PlusIcon size={16} color={theme.palette.sky.color} weight="bold" />
        </View>
        <Text style={styles.addText}>Add accessory</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    gap: 6,
  },
  rowPressed: {
    backgroundColor: interaction.pressedBg,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    gap: 10,
  },
  addIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.alpha(theme.neutral.border, 0.6),
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: {
    color: theme.palette.sky.color,
    fontSize: 13,
    fontWeight: '600',
  },
})
