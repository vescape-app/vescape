import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { XIcon, type Icon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

const FADE_DURATION = 120

/** Default cap for the scrollable body so a long message never pushes the footer off-card. */
const DEFAULT_BODY_MAX_HEIGHT = 320

interface FadeCardModalProps {
  visible: boolean
  /**
   * Backdrop tap, close button and Android hardware back. Omit to make the card non-dismissible —
   * back is then swallowed and no close affordance renders.
   */
  onDismiss?: () => void
  /** Ignore every dismiss affordance without unmounting them (e.g. a confirm request in flight). */
  dismissDisabled?: boolean
  title?: string
  titleIcon?: Icon
  titleIconColor?: string
  titleIconWeight?: 'bold' | 'fill'
  /** Overrides the default primary-text title colour (a type accent, say). */
  titleColor?: string
  /** Close button in the header. Ignored when the card is non-dismissible. */
  showClose?: boolean
  /** Action row under the body. */
  footer?: ReactNode
  /** Wrap the body in a `ScrollView`. Disable for short static content. */
  scrollable?: boolean
  bodyMaxHeight?: number
  cardStyle?: StyleProp<ViewStyle>
  children: ReactNode
  /** The card finished fading out and is gone. Not called for a fade-out cut short by a reopen. */
  onExited?: () => void
}

/**
 * The shared centered-card modal: fade + scale in, fade out, dim backdrop, optional icon/title
 * header with a close button, scrollable body, footer action row.
 *
 * Owns the mount lifecycle so the exit animation can finish before the card unmounts. Consumers
 * that swap content while closing (one queue item to the next) must keep rendering the outgoing
 * content themselves — this component never freezes `children`.
 */
export function FadeCardModal({
  visible,
  onDismiss,
  dismissDisabled = false,
  title,
  titleIcon: TitleIcon,
  titleIconColor,
  titleIconWeight = 'bold',
  titleColor,
  showClose = true,
  footer,
  scrollable = true,
  bodyMaxHeight = DEFAULT_BODY_MAX_HEIGHT,
  cardStyle,
  children,
  onExited,
}: FadeCardModalProps) {
  const [opacity] = useState(() => new Animated.Value(0))
  const [scale] = useState(() => new Animated.Value(0.92))
  const [mounted, setMounted] = useState(false)
  const [prevVisible, setPrevVisible] = useState(false)
  // Held in a ref so an inline callback can't retrigger the animation effect mid-fade.
  const onExitedRef = useRef(onExited)
  useEffect(() => {
    onExitedRef.current = onExited
  })

  if (visible !== prevVisible) {
    setPrevVisible(visible)
    if (visible) setMounted(true)
  }

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: FADE_DURATION, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: FADE_DURATION, useNativeDriver: true }),
      ]).start()
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: FADE_DURATION, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 0.92, duration: FADE_DURATION, useNativeDriver: true }),
        // Ignore a cancelled fade-out: a reopen mid-exit stops this animation with
        // `finished: false`, and unmounting then would hide the reopened card.
      ]).start(({ finished }) => {
        if (!finished) return
        setMounted(false)
        onExitedRef.current?.()
      })
    }
  }, [visible, mounted, opacity, scale])

  if (!mounted) return null

  const dismiss = onDismiss && !dismissDisabled ? onDismiss : undefined
  const header =
    title !== undefined ? (
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          {TitleIcon ? (
            <TitleIcon size={16} color={titleIconColor} weight={titleIconWeight} />
          ) : null}
          <Text style={[styles.title, titleColor ? { color: titleColor } : null]}>{title}</Text>
        </View>
        {onDismiss && showClose ? (
          <Pressable
            style={styles.closeButton}
            onPress={dismiss}
            disabled={dismissDisabled}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <XIcon size={15} color={theme.neutral.textSecondary} weight="bold" />
          </Pressable>
        ) : null}
      </View>
    ) : null

  return (
    <Modal
      visible
      transparent
      animationType="none"
      // No `onDismiss` means the card is non-dismissible: swallow Android back instead of exiting.
      onRequestClose={() => dismiss?.()}
    >
      <Animated.View style={[styles.overlay, { opacity }]}>
        {onDismiss ? (
          <Pressable style={styles.backdrop} onPress={dismiss} disabled={dismissDisabled} />
        ) : null}
        <Animated.View style={[styles.card, cardStyle, { transform: [{ scale }] }]}>
          {header}
          {scrollable ? (
            <ScrollView style={{ maxHeight: bodyMaxHeight }} contentContainerStyle={styles.body}>
              {children}
            </ScrollView>
          ) : (
            children
          )}
          {footer}
        </Animated.View>
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.6),
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    maxHeight: '78%',
    backgroundColor: theme.neutral.surfaceDeep,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    padding: 18,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    color: theme.neutral.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.neutral.surface,
  },
  body: {
    paddingRight: 2,
  },
})
