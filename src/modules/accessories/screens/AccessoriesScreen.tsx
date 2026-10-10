import { useFocusEffect } from 'expo-router'
import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PlusIcon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'
import { AccessoryRow } from '@/modules/accessories/components/AccessoryRow'
import { AccessoryIcon } from '@/modules/accessories/constants/accessoryIcon'
import { accessoryNeedsSetup, useAccessoryStore } from '@/modules/accessories/store/accessoryStore'

export function AccessoriesScreen({
  onAddAccessory,
  onOpenAccessory,
}: {
  onAddAccessory: () => void
  onOpenAccessory: (accessoryId: string) => void
}) {
  const accessories = useAccessoryStore((s) => s.accessories)
  const sync = useAccessoryStore((s) => s.sync)
  useFocusEffect(sync)

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={AccessoryIcon}
          iconColor={theme.palette.teal.color}
          description="Accessories are sensors and lights that work with your connected board."
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
              detail={`v${accessory.firmwareVersion}`}
              phase={accessory.phase}
              needsSetup={accessoryNeedsSetup(accessory)}
              onPress={() => onOpenAccessory(accessory.accessoryId)}
            />
          ))
        )}
        <Button label="Add accessory" icon={PlusIcon} onPress={onAddAccessory} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  content: {
    padding: 16,
    gap: 12,
  },
})
