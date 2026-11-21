import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import type { Icon } from 'phosphor-react-native'

import {
  presentationWidgetSurface,
  useResolvedSecondaryWidgetSurface,
  type WidgetSize,
} from '@/components/widgets/widgetSurface'
import { theme, type ThemeColor } from '@/constants/theme'

interface CanvasWidgetProps {
  icon: Icon
  title: string
  accent?: ThemeColor
  active?: boolean
  size?: WidgetSize
  height?: number
  footer?: ReactNode
  action?: ReactNode
  children?: ReactNode
  surface?: 'presentation' | 'secondary'
}

export function CanvasWidget({
  icon: IconComponent,
  title,
  accent = theme.neutral.textSecondary,
  active = false,
  size = 'full',
  height,
  footer,
  action,
  children,
  surface = 'presentation',
}: CanvasWidgetProps) {
  const square = size === 'square'
  const secondary = surface === 'secondary'
  const secondarySurface = useResolvedSecondaryWidgetSurface()

  return (
    <View
      style={[
        styles.widget,
        secondary && secondarySurface,
        square ? styles.square : { height },
        active && { borderColor: accent },
      ]}
    >
      <View style={[styles.header, secondary && styles.secondaryHeader]}>
        <IconComponent size={square ? 18 : secondary ? 22 : 20} color={accent} weight="duotone" />
        {square ? null : (
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        )}
        {action ?? (active ? <View style={[styles.dot, { backgroundColor: accent }]} /> : null)}
      </View>
      <View style={styles.body}>{children}</View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  widget: {
    ...presentationWidgetSurface,
    padding: 16,
    gap: 10,
  },
  square: {
    aspectRatio: 1,
    padding: 14,
    gap: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  secondaryHeader: {
    gap: 14,
  },
  title: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  footer: {
    flexDirection: 'row',
  },
})
