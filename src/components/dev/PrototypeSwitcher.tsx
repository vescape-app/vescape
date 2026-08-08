import { useEffect } from 'react'
import { CaretLeftIcon, CaretRightIcon } from 'phosphor-react-native'
import { router } from 'expo-router'
import { Platform, Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { interaction, theme } from '@/constants/theme'

interface PrototypeVariant {
  key: string
  label: string
}

export function PrototypeSwitcher({
  variants,
  current,
}: {
  variants: readonly PrototypeVariant[]
  current: string
}) {
  const currentIndex = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current),
  )

  const cycle = (offset: number) => {
    const next = variants[(currentIndex + offset + variants.length) % variants.length]
    router.setParams({ variant: next.key })
  }

  useEffect(() => {
    if (Platform.OS !== 'web') return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.matches('input, textarea, [contenteditable]') || target.isContentEditable)
      ) {
        return
      }
      if (event.key === 'ArrowLeft') cycle(-1)
      if (event.key === 'ArrowRight') cycle(1)
    }
    globalThis.addEventListener('keydown', onKeyDown)
    return () => globalThis.removeEventListener('keydown', onKeyDown)
  })

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={styles.bar}>
        <Pressable
          accessibilityLabel="Previous prototype variant"
          onPress={() => cycle(-1)}
          style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
        >
          <CaretLeftIcon size={16} color={theme.palette.mono.white} weight="bold" />
        </Pressable>
        <Text style={styles.label}>
          {variants[currentIndex].key} — {variants[currentIndex].label}
        </Text>
        <Pressable
          accessibilityLabel="Next prototype variant"
          onPress={() => cycle(1)}
          style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
        >
          <CaretRightIcon size={16} color={theme.palette.mono.white} weight="bold" />
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 94,
    zIndex: 200,
    alignItems: 'center',
  },
  bar: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 19,
    borderWidth: 1,
    borderColor: theme.palette.mono.white,
    backgroundColor: theme.palette.mono.black,
    overflow: 'hidden',
  },
  arrow: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: interaction.pressedOpacity,
  },
  label: {
    minWidth: 156,
    color: theme.palette.mono.white,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
})
