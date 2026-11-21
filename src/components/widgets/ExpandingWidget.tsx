import { useRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { CaretRightIcon } from 'phosphor-react-native'

import { useWidgetFocus } from '@/components/overlays/widgetFocus'
import { WidgetHeader, type WidgetHeaderProps } from '@/components/widgets/widgetHeader'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'

interface ExpandingWidgetProps extends WidgetHeaderProps {
  body: React.ComponentType
  surface?: boolean
}

export function ExpandingWidget({ body, surface = true, ...header }: ExpandingWidgetProps) {
  const surfaceStyle = useResolvedSecondaryWidgetSurface()
  const rowRef = useRef<View>(null)
  const focus = useWidgetFocus()

  return (
    <View ref={rowRef} collapsable={false} style={surface && [surfaceStyle, styles.widget]}>
      <Pressable
        onPress={() => focus.open(rowRef, header, body)}
        style={({ pressed }) => [styles.header, pressed && styles.headerPressed]}
        accessibilityRole="button"
        accessibilityLabel={header.title}
      >
        <WidgetHeader {...header} />
        <CaretRightIcon size={16} color={theme.neutral.textMuted} weight="bold" />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  widget: {
    padding: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 46,
    gap: 12,
  },
  headerPressed: {
    opacity: 0.7,
  },
})
