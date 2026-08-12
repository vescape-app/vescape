/** PROTOTYPE — throwaway floating variant switcher. Dev builds only. */
import { Pressable, StyleSheet, View } from 'react-native'
import { CaretLeftIcon, CaretRightIcon } from 'phosphor-react-native'
import { router } from 'expo-router'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

export type PrototypeSwitcherProps = {
  variants: string[]
  current: string
  label?: string
}

export function PrototypeSwitcher({ variants, current, label }: PrototypeSwitcherProps) {
  if (!__DEV__) return null

  const index = Math.max(0, variants.indexOf(current))
  const go = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length]
    router.setParams({ variant: next })
  }

  return (
    <View style={styles.bar} pointerEvents="box-none">
      <View style={styles.pill}>
        <Pressable style={styles.arrow} onPress={() => go(-1)} hitSlop={8}>
          <CaretLeftIcon size={18} weight="bold" color="#0f172a" />
        </Pressable>
        <Text style={styles.label}>
          {current}
          {label ? ` — ${label}` : ''}
        </Text>
        <Pressable style={styles.arrow} onPress={() => go(1)} hitSlop={8}>
          <CaretRightIcon size={18} weight="bold" color="#0f172a" />
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#facc15',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  arrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha('#000000', 0.1),
  },
  label: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 13,
    minWidth: 120,
    textAlign: 'center',
  },
})
