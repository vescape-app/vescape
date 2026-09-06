import { useRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { CaretRightIcon } from 'phosphor-react-native'

import { useWidgetFocus } from '@/components/overlays/widgetFocus'
import { WidgetHeader, type WidgetHeaderProps } from '@/components/widgets/widgetHeader'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'

interface ExpandingWidgetProps extends WidgetHeaderProps {
  /**
   * The expanded content. A component, not an element: the panel is rendered by the focus layer, so
   * the body has to own whatever state it needs rather than inherit it from this row's render.
   */
  body: React.ComponentType
  surface?: boolean
}

/**
 * A widget row whose body opens as a focused panel over the rest of the container instead of
 * pushing it around. Growing in place fought the drawer's scroll — which is also its dismissal
 * gesture — so the expanded state lives in the focus layer, above a scrim, until it is dismissed.
 */
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
