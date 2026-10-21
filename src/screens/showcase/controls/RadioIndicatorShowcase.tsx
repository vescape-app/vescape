import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { RadioIndicator } from '@/components/controls/RadioIndicator'
import { Text } from '@/components/base/Text'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { theme } from '@/constants/theme'

const OPTIONS = ['Retro', 'Classic', 'Custom'] as const

export function RadioIndicatorShowcase() {
  const [selected, setSelected] = useState<string>(OPTIONS[0])

  return (
    <ShowcaseCard name="RadioIndicator">
      <Text style={styles.group}>sm — list rows</Text>
      {OPTIONS.map((option) => (
        <Pressable
          key={option}
          style={styles.row}
          onPress={() => setSelected(option)}
          accessibilityRole="radio"
          accessibilityState={{ checked: option === selected }}
        >
          <RadioIndicator selected={option === selected} />
          <Text style={styles.label}>{option}</Text>
        </Pressable>
      ))}

      <Text style={styles.group}>lg — card trailing edge, accents</Text>
      <View style={styles.cells}>
        <RadioIndicator selected={false} size="lg" />
        <RadioIndicator selected size="lg" />
        <RadioIndicator selected size="lg" accent={theme.palette.pink.color} />
        <RadioIndicator selected size="lg" accent={theme.palette.amber.color} />
        <RadioIndicator selected size="lg" accent={theme.palette.green.color} />
      </View>
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  group: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  label: {
    color: theme.neutral.textPrimary,
    fontSize: 14,
  },
  cells: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
})
