// PROTOTYPE — throwaway. Host + switcher for the tune-screen variants.
// Reachable only in dev builds, from /tune?variant=A ... /tune?variant=E.
// Delete this whole folder once a direction is picked. See NOTES.md.

import { Pressable, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { CaretLeftIcon, CaretRightIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { VariantA, VARIANT_A_NAME } from '@/modules/tune/components/prototype/VariantA'
import { VariantB, VARIANT_B_NAME } from '@/modules/tune/components/prototype/VariantB'
import { VariantC, VARIANT_C_NAME } from '@/modules/tune/components/prototype/VariantC'
import { VariantD, VARIANT_D_NAME } from '@/modules/tune/components/prototype/VariantD'
import { VariantE, VARIANT_E_NAME } from '@/modules/tune/components/prototype/VariantE'
import type { TuneVariantProps } from '@/modules/tune/components/prototype/types'

const VARIANTS = [
  { key: 'current', name: 'Current screen', Component: null },
  { key: 'A', name: VARIANT_A_NAME, Component: VariantA },
  { key: 'B', name: VARIANT_B_NAME, Component: VariantB },
  { key: 'C', name: VARIANT_C_NAME, Component: VariantC },
  { key: 'D', name: VARIANT_D_NAME, Component: VariantD },
  { key: 'E', name: VARIANT_E_NAME, Component: VariantE },
] as const

export type TuneVariantKey = (typeof VARIANTS)[number]['key']

export function normalizeVariantKey(value: string | string[] | undefined): TuneVariantKey {
  const key = Array.isArray(value) ? value[0] : value
  return VARIANTS.some((v) => v.key === key) ? (key as TuneVariantKey) : 'current'
}

export function TunePrototypeVariant({
  variantKey,
  ...props
}: TuneVariantProps & { variantKey: TuneVariantKey }) {
  const entry = VARIANTS.find((v) => v.key === variantKey)
  if (!entry?.Component) return null
  const Component = entry.Component
  return <Component {...props} />
}

export function TunePrototypeSwitcher({ variantKey }: { variantKey: TuneVariantKey }) {
  const router = useRouter()
  const index = VARIANTS.findIndex((v) => v.key === variantKey)
  const entry = VARIANTS[index]

  const go = (direction: 1 | -1) => {
    const next = VARIANTS[(index + direction + VARIANTS.length) % VARIANTS.length]
    router.setParams({ variant: next.key })
  }

  return (
    <View style={styles.bar} pointerEvents="box-none">
      <View style={styles.pill}>
        <Pressable style={styles.arrow} hitSlop={8} onPress={() => go(-1)}>
          <CaretLeftIcon size={14} color={theme.palette.mono.black} weight="bold" />
        </Pressable>
        <Text style={styles.label} numberOfLines={1}>
          {entry.key === 'current' ? entry.name : `${entry.key} - ${entry.name}`}
        </Text>
        <Pressable style={styles.arrow} hitSlop={8} onPress={() => go(1)}>
          <CaretRightIcon size={14} color={theme.palette.mono.black} weight="bold" />
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
    bottom: 104,
    alignItems: 'center',
    zIndex: 20,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: theme.palette.yellow.color,
  },
  arrow: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha(theme.palette.mono.white, 0.4),
  },
  label: {
    color: theme.palette.mono.black,
    fontSize: 12,
    fontWeight: '900',
    maxWidth: 220,
  },
})
