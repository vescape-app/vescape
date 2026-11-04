import { useLayoutEffect } from 'react'
import { ScrollView, StyleSheet, View, type ScrollViewProps } from 'react-native'
import { useNavigation } from 'expo-router'
import { useHeaderHeight } from 'expo-router/build/react-navigation/elements'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

function PageHeaderBackground() {
  const neutral = useResolvedNeutralColors()
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          experimental_backgroundImage: `linear-gradient(to bottom, ${neutral.bg} 0%, ${theme.alpha(neutral.bg, 0.85)} 55%, ${theme.alpha(neutral.bg, 0)} 100%)`,
        },
      ]}
    />
  )
}

/**
 * Full-page content scrolls beneath chrome; resting content clears both safe areas.
 * The transparent header relies on `patches/expo-router@*.patch`: without it, the JS stack nests
 * the header in a zero-height box and Android accessibility (TalkBack, Maestro) loses it.
 */
export function PageScrollView({ contentContainerStyle, ...props }: ScrollViewProps) {
  const navigation = useNavigation()
  const headerHeight = useHeaderHeight()
  const insets = useSafeAreaInsets()
  const content = StyleSheet.flatten(contentContainerStyle) ?? {}

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTransparent: true,
      headerBackground: () => <PageHeaderBackground />,
    })
  }, [navigation])

  return (
    <ScrollView
      {...props}
      contentInsetAdjustmentBehavior="never"
      scrollIndicatorInsets={{ top: headerHeight, bottom: insets.bottom }}
      contentContainerStyle={[
        contentContainerStyle,
        {
          paddingTop:
            headerHeight +
            Number(content.paddingTop ?? content.paddingVertical ?? content.padding ?? 0),
          paddingBottom:
            insets.bottom +
            Number(content.paddingBottom ?? content.paddingVertical ?? content.padding ?? 0) +
            16,
        },
      ]}
    />
  )
}
