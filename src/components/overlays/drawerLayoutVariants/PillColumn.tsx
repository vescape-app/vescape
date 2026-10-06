/** PROTOTYPE variant — vertical pill on the trigger, inline header + view bottom-aligned beside it. */
import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { TabCircle } from '@/components/overlays/drawerLayoutVariants/TabCircle'
import type { DrawerLayoutVariantProps } from '@/components/overlays/drawerLayoutVariants/types'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

export function PillColumn({
  tabs,
  activeTab,
  onTabChange,
  testID,
  slotSize,
  railWidth,
  outset,
  side,
  opensFromTop,
  close,
  children,
}: DrawerLayoutVariantProps) {
  const neutral = useResolvedNeutralColors()
  const tab = tabs.find((candidate) => candidate.id === activeTab) ?? tabs[0]
  const IconComponent = tab.icon
  const endAlign = opensFromTop ? 'flex-start' : 'flex-end'

  return (
    <View style={[styles.row, { flexDirection: side === 'left' ? 'row' : 'row-reverse' }]}>
      <View style={{ width: railWidth, justifyContent: endAlign }}>
        <View
          style={[
            styles.pill,
            {
              padding: outset - 1,
              backgroundColor: neutral.surfaceDeep,
              borderColor: neutral.border,
            },
          ]}
        >
          {tabs.map((candidate) => (
            <TabCircle
              key={candidate.id}
              tab={candidate}
              size={slotSize}
              active={candidate.id === tab.id}
              testID={testID ? `${testID}-tab-${candidate.id}` : undefined}
              onPress={() => onTabChange(candidate.id)}
            />
          ))}
        </View>
      </View>
      <View style={[styles.column, { justifyContent: endAlign }]}>
        <Pressable style={styles.header} onPress={close} accessibilityRole="button">
          <IconComponent size={22} color={tab.color} weight="duotone" />
          <Text style={[styles.title, { color: neutral.textPrimary }]}>{tab.label}</Text>
        </Pressable>
        {children}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    gap: 10,
  },
  pill: {
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  column: {
    flex: 1,
    minWidth: 0,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    minHeight: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
})
