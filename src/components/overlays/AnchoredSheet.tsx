import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import type { Icon } from 'phosphor-react-native'

import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Text } from '@/components/base/Text'
import {
  getModalCoordinateOffset,
  measureTrigger,
  type TriggerLayout,
} from '@/components/overlays/measureTrigger'
import { theme } from '@/constants/theme'

const OPEN_DURATION = 260
const CLOSE_DURATION = 180
const SCREEN_EDGE_PADDING = 10
/** Fraction of the screen height a sheet is allowed to occupy. */
const HEIGHT_FRACTION = 0.75

type SheetLayoutMode = {
  mode: 'floating'
  matchTriggerWidth: boolean
  minWidth?: number
}

interface ComputedLayout {
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
  transformOrigin: string
  /** translateY the panel animates in from (px). */
  translateFrom: number
}

function computeLayout(
  layoutMode: SheetLayoutMode,
  trigger: TriggerLayout,
  insets: { top: number; bottom: number },
): ComputedLayout {
  const screen = Dimensions.get('window')
  const screenHeight = screen.height + getModalCoordinateOffset()

  // Floating: centered on the trigger, fully covering it — grows down (or, if
  // short on space, up) from the trigger's own edge instead of dropping below it.
  const topSafe = insets.top + SCREEN_EDGE_PADDING
  const bottomSafe = insets.bottom + SCREEN_EDGE_PADDING
  const spaceAbove = trigger.y + trigger.height - topSafe
  const spaceBelow = screenHeight - trigger.y - bottomSafe
  const preferredMaxHeight = screenHeight * HEIGHT_FRACTION
  const dropAbove = spaceBelow < preferredMaxHeight && spaceAbove > spaceBelow
  const maxHeight = Math.max(120, Math.min(preferredMaxHeight, dropAbove ? spaceAbove : spaceBelow))

  const edgeBoundWidth = screen.width - SCREEN_EDGE_PADDING * 2
  const width = layoutMode.matchTriggerWidth
    ? trigger.width
    : Math.min(
        edgeBoundWidth,
        Math.max(trigger.width, layoutMode.minWidth ?? Math.min(360, edgeBoundWidth)),
      )
  const centeredLeft = trigger.x + trigger.width / 2 - width / 2
  const left = Math.max(
    SCREEN_EDGE_PADDING,
    Math.min(centeredLeft, screen.width - SCREEN_EDGE_PADDING - width),
  )

  if (dropAbove) {
    return {
      bottom: Math.max(insets.bottom, screenHeight - (trigger.y + trigger.height)),
      left,
      width,
      maxHeight,
      transformOrigin: '50% 100%',
      translateFrom: 14,
    }
  }
  return {
    top: Math.max(insets.top, trigger.y),
    left,
    width,
    maxHeight,
    transformOrigin: '50% 0%',
    translateFrom: -14,
  }
}

interface SheetProps {
  visible: boolean
  triggerRef: React.RefObject<View | null>
  onClose: () => void
  layout: SheetLayoutMode
  title?: string
  /** Optional glyph shown left of a centred title. */
  icon?: Icon
  iconColor?: string
  contentContainerStyle?: StyleProp<ViewStyle>
  children: React.ReactNode
}

/**
 * Shared chrome for popover-style "sheets": a translucent, dimmed-backdrop
 * panel that scales + slides in from the trigger that opened it. Positioning
 * (grow from a screen corner vs. float centered under the trigger) is picked
 * via `layout`; {@link FloatingSheet} below wires up
 * the two shapes callers actually need.
 */
function Sheet({
  visible,
  triggerRef,
  onClose,
  layout,
  title,
  icon: IconComponent,
  iconColor = theme.palette.slate.textSecondary,
  contentContainerStyle,
  children,
}: SheetProps) {
  const insets = useSafeAreaInsets()
  const [triggerLayout, setTriggerLayout] = useState<TriggerLayout | null>(null)
  const [mounted, setMounted] = useState(false)
  const progress = useMemo(() => new Animated.Value(0), [])

  useEffect(() => {
    if (!visible) return
    void measureTrigger(triggerRef).then((measured) => {
      setTriggerLayout({
        ...measured,
        y: measured.y + getModalCoordinateOffset(),
      })
      setMounted(true)
      progress.setValue(0)
      Animated.timing(progress, {
        toValue: 1,
        duration: OPEN_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
    })
  }, [visible, triggerRef, progress])

  const handleClose = useCallback(() => {
    Animated.timing(progress, {
      toValue: 0,
      duration: CLOSE_DURATION,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setMounted(false)
      setTriggerLayout(null)
      onClose()
    })
  }, [progress, onClose])

  useEffect(() => {
    if (!visible && mounted) handleClose()
  }, [visible, mounted, handleClose])

  if (!mounted || !triggerLayout) return null

  const computed = computeLayout(layout, triggerLayout, insets)
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1],
  })
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [computed.translateFrom, 0],
  })

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={handleClose}
    >
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          {
            top: computed.top,
            bottom: computed.bottom,
            left: computed.left,
            width: computed.width,
            maxHeight: computed.maxHeight,
            transformOrigin: computed.transformOrigin,
            opacity: progress,
            transform: [{ scale }, { translateY }],
          },
        ]}
      >
        {title ? (
          <View style={styles.header}>
            {IconComponent ? <IconComponent size={18} color={iconColor} weight="duotone" /> : null}
            <Text style={styles.title}>{title}</Text>
          </View>
        ) : null}
        <ScrollView
          contentContainerStyle={[styles.content, contentContainerStyle]}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {children}
        </ScrollView>
      </Animated.View>
    </Modal>
  )
}

interface FloatingSheetProps {
  visible: boolean
  triggerRef: React.RefObject<View | null>
  onClose: () => void
  matchTriggerWidth?: boolean
  minWidth?: number
  title?: string
  contentContainerStyle?: StyleProp<ViewStyle>
  children: React.ReactNode
}

/**
 * A compact popover that floats centered under (or above, if short on space)
 * its trigger — same translucent/animated feel as {@link EdgeDrawer}, sized
 * to its content instead of growing from a screen corner.
 */
export function FloatingSheet({
  matchTriggerWidth = true,
  minWidth,
  ...props
}: FloatingSheetProps) {
  return <Sheet {...props} layout={{ mode: 'floating', matchTriggerWidth, minWidth }} />
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.3),
  },
  sheet: {
    position: 'absolute',
    backgroundColor: theme.alpha(theme.palette.slate.surface, 0.85),
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    overflow: 'hidden',
    shadowColor: theme.palette.mono.black,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  title: {
    color: theme.palette.slate.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  content: {
    padding: 12,
    gap: 12,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  modalGestureRoot: {
    flex: 1,
  },
  /**
   * A flat translucent scrim rather than a vignette gradient. The gradient was there to fake a panel
   * edge, but its falloff never lined up with where the drawer actually ended, and the dismissal
   * fade is what conveys the drawer leaving.
   */
  drawerScrim: {
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
  },
  drawerBody: {
    paddingHorizontal: 12,
    gap: 10,
  },
  drawerHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  drawerTitle: {
    color: theme.palette.slate.textPrimary,
    fontSize: 22,
    fontWeight: '300',
  },
  drawerContent: {
    gap: 12,
  },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: theme.alpha(theme.palette.slate.textSecondary, 0.6),
    marginVertical: 3,
  },
})
