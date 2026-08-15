import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import type { Icon } from 'phosphor-react-native'

import {
  presentationWidgetSurface,
  secondaryWidgetSurface,
  type WidgetSize,
} from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'

interface CanvasWidgetProps {
  icon: Icon
  title: string
  /** Accent for the icon, the active border and the status dot. */
  accent?: string
  /** Raise the border to `accent` and show a status dot. */
  active?: boolean
  /** Footprint in the widget grid. `square` forces an aspect-1 tile and ignores `height`. */
  size?: WidgetSize
  /** Fixed widget height — content is centred within it. Ignored when `size` is `square`. */
  height?: number
  /** Pinned bottom area, e.g. an action button. */
  footer?: ReactNode
  /** Trailing header control, e.g. a dismiss button or status badge. Far-right of the title
   *  row; takes the status dot's place (the dot is hidden whenever an action is present). */
  action?: ReactNode
  /** Free-form body content, vertically centred. */
  children?: ReactNode
  /** Optional framed surface for canvas widgets presented alongside settings rows. */
  surface?: 'presentation' | 'secondary'
}

/** A free-canvas widget: header (icon + title + status) over any body, with an optional pinned footer. */
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

  return (
    <View
      style={[
        styles.widget,
        secondary && styles.secondary,
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
  secondary: {
    ...secondaryWidgetSurface,
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
