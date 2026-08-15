/** PROTOTYPE — throwaway floating variant switcher. Dev builds only. */
import { Pressable, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { CaretLeftIcon, CaretRightIcon } from 'phosphor-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

interface Props {
  variants: { key: string; name: string }[]
  current: string
}

export function PrototypeSwitcher({ variants, current }: Props) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  if (!__DEV__) return null

  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  )
  const go = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length]!
    router.setParams({ variant: next.key })
  }

  return (
    <View style={[styles.bar, { bottom: insets.bottom + 12 }]} pointerEvents="box-none">
      <View style={styles.pill}>
        <Pressable onPress={() => go(-1)} hitSlop={10} style={styles.arrow}>
          <CaretLeftIcon size={16} color={theme.palette.mono.black} weight="bold" />
        </Pressable>
        <Text style={styles.label} numberOfLines={1}>
          {variants[index]!.key} — {variants[index]!.name}
        </Text>
        <Pressable onPress={() => go(1)} hitSlop={10} style={styles.arrow}>
          <CaretRightIcon size={16} color={theme.palette.mono.black} weight="bold" />
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
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: theme.palette.mono.white,
  },
  arrow: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: theme.palette.mono.black,
    fontSize: 12,
    fontWeight: '800',
    maxWidth: 220,
  },
})
