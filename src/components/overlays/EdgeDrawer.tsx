import { useEffect, useState } from 'react'
import {
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type FlatList,
  type ListRenderItem,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Reanimated from 'react-native-reanimated'
import type { Icon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { NativeScrollGestureContext } from '@/components/gestures/NativeScrollGestureContext'
import {
  getModalCoordinateOffset,
  measureTrigger,
  type TriggerLayout,
} from '@/components/overlays/measureTrigger'
import { useEdgeDrawerDismissal } from '@/components/overlays/useEdgeDrawerDismissal'
import { DrawerLayoutSwitcher } from '@/components/overlays/drawerLayout.prototype'
import { theme, type ThemeColor } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

interface EdgeDrawerVirtualizedContent {
  data: readonly unknown[]
  renderItem: ListRenderItem<unknown>
  keyExtractor: (item: unknown, index: number) => string
  empty?: React.ReactElement | null
  footer?: React.ReactElement | null
  separator?: React.ComponentType
  onEndReached?: () => void
  onEndReachedThreshold?: number
  testID?: string
}

/** Where an anchored body sits relative to the trigger it grows out of. */
export interface EdgeDrawerAnchorGeometry {
  /** The trigger's own diameter, for a slot that covers it exactly. */
  slotSize: number
  /** Trigger plus `outset` on both sides: the width of a column centred on the trigger. */
  railWidth: number
  side: 'left' | 'right'
  opensFromTop: boolean
  /** Full drawer body width between the margins. */
  bodyWidth: number
  close: () => void
}

/**
 * A body grown out of the trigger, e.g. tabs: laid out from the trigger's corner, with its
 * trigger-side edge `outset` past the trigger and its far end at the drawer's own edge.
 */
export interface EdgeDrawerRail {
  side: 'left' | 'right'
  /** How far the body's chrome reaches past the trigger on every side. */
  outset: number
  /** Replaces the title and children: the owner composes the whole body. */
  render: (geometry: EdgeDrawerAnchorGeometry) => React.ReactNode
}

export interface EdgeDrawerProps {
  visible: boolean
  triggerRef: React.RefObject<View | null>
  onClose: () => void
  /** Which edge the drawer opens from. `auto` picks the edge nearest the trigger. */
  edge?: 'auto' | 'top' | 'bottom'
  title?: string
  /** Optional glyph shown left of a centred title. */
  icon?: Icon
  iconColor?: ThemeColor
  /** Scroll newly expanded content into view when the drawer grows. */
  autoScrollOnContentExpand?: boolean
  /** Bring one child into the initially visible drawer area after opening. */
  initialFocusRef?: React.RefObject<View | null>
  /** Called after scrolling settles near the end of the drawer content. */
  onReachContentEnd?: () => void
  backdropTestID?: string
  children?: React.ReactNode
  /** Dedicated FlatList path for long/unknown content; avoids nesting virtualization in a ScrollView. */
  virtualizedContent?: EdgeDrawerVirtualizedContent
  /** Column anchored on the trigger, beside `children`. Not supported with `virtualizedContent`. */
  rail?: EdgeDrawerRail
}

/**
 * A full-width edge drawer, dismissed by dragging it back toward the edge it opened from. It comes
 * from the bottom unless told otherwise: that is where a thumb rests, and top drawers are the rare
 * exception rather than something every caller should have to opt out of.
 */
export function EdgeDrawer({
  visible,
  triggerRef,
  onClose,
  edge = 'bottom',
  title,
  icon: IconComponent,
  iconColor = theme.neutral.textSecondary,
  autoScrollOnContentExpand = false,
  initialFocusRef,
  onReachContentEnd,
  backdropTestID,
  children,
  virtualizedContent,
  rail,
}: EdgeDrawerProps) {
  const {
    mounted,
    closing,
    opensFromTop,
    scrollRef,
    nativeScrollGesture,
    backdropStyle,
    presenceStyle,
    edgePadding,
    close,
    startOpen,
    scrollHandler,
    handleContentSizeChange,
    handleScrollEnd,
    handleScrollEndDrag,
    dismissAreaHeight,
  } = useEdgeDrawerDismissal({
    visible,
    edge,
    triggerRef,
    initialFocusRef,
    autoScrollOnContentExpand,
    // Beside a rail the content ends level with the trigger, which only holds at the content end.
    openAtEnd: rail !== undefined,
    onClose,
    onReachContentEnd,
  })

  // JS-side resolution: baked adaptive tokens in a StyleSheet go stale inside a live Modal window
  // after the rider changes the appearance in place — the window re-resolves only on remount.
  const neutral = useResolvedNeutralColors()
  const { anchor, railLayout } = useAnchoredRail(
    virtualizedContent ? undefined : rail,
    visible,
    triggerRef,
    opensFromTop,
  )

  // A rail drawer waits for the trigger's position: laid out without it, the first frame would
  // land somewhere else and jump.
  if (!mounted || (rail && !railLayout)) return null

  const emptyDismissArea = (
    <Pressable style={{ height: dismissAreaHeight }} onPress={close} accessible={false} />
  )

  const drawerTitle = (
    <DrawerTitle
      title={title}
      icon={IconComponent}
      iconColor={iconColor}
      color={neutral.textPrimary}
      onPress={close}
    />
  )

  const scrimStyle: StyleProp<ViewStyle> = {
    backgroundColor: theme.alpha(neutral.surfaceDeep, 0.85),
  }
  const colorStyle: StyleProp<ViewStyle> = {
    backgroundColor: theme.alpha(neutral.textSecondary, 0.6),
  }

  const listHeader = virtualizedContent ? (
    <>
      {!opensFromTop ? emptyDismissArea : null}
      <View style={[styles.listChrome, opensFromTop && { paddingTop: edgePadding }]}>
        {!opensFromTop ? <View style={[styles.grabber, colorStyle]} /> : null}
        {drawerTitle}
      </View>
    </>
  ) : null

  const listFooter = virtualizedContent ? (
    <>
      {virtualizedContent.footer}
      <View style={[styles.listChrome, opensFromTop ? undefined : { paddingBottom: edgePadding }]}>
        {opensFromTop ? <View style={[styles.grabber, colorStyle]} /> : null}
      </View>
      {opensFromTop ? emptyDismissArea : null}
    </>
  ) : null

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={close}
      onShow={startOpen}
    >
      <GestureHandlerRootView style={styles.modalGestureRoot}>
        <View style={styles.drawer}>
          <Reanimated.View
            style={[StyleSheet.absoluteFill, styles.drawerScrim, scrimStyle, backdropStyle]}
          >
            <Pressable testID={backdropTestID} style={StyleSheet.absoluteFill} onPress={close} />
          </Reanimated.View>
        </View>
        <Reanimated.View style={[styles.drawer, presenceStyle]}>
          <NativeScrollGestureContext.Provider value={nativeScrollGesture}>
            <GestureDetector gesture={nativeScrollGesture}>
              {virtualizedContent ? (
                <Reanimated.FlatList
                  ref={scrollRef as React.RefObject<FlatList<unknown>>}
                  data={virtualizedContent.data as unknown[]}
                  renderItem={virtualizedContent.renderItem}
                  keyExtractor={virtualizedContent.keyExtractor}
                  ListHeaderComponent={listHeader}
                  ListEmptyComponent={virtualizedContent.empty}
                  ListFooterComponent={listFooter}
                  ItemSeparatorComponent={virtualizedContent.separator}
                  contentContainerStyle={styles.virtualizedContent}
                  onEndReached={virtualizedContent.onEndReached}
                  onEndReachedThreshold={virtualizedContent.onEndReachedThreshold ?? 0.6}
                  onContentSizeChange={handleContentSizeChange}
                  onScroll={scrollHandler}
                  onScrollEndDrag={handleScrollEndDrag}
                  onMomentumScrollEnd={handleScrollEnd}
                  scrollEnabled={!closing}
                  scrollEventThrottle={16}
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                  overScrollMode="never"
                  testID={virtualizedContent.testID}
                  initialNumToRender={8}
                  maxToRenderPerBatch={8}
                  windowSize={7}
                />
              ) : (
                <Reanimated.ScrollView
                  ref={
                    scrollRef as React.RefObject<React.ComponentRef<typeof Reanimated.ScrollView>>
                  }
                  onContentSizeChange={handleContentSizeChange}
                  onScroll={scrollHandler}
                  onScrollEndDrag={handleScrollEndDrag}
                  onMomentumScrollEnd={handleScrollEnd}
                  scrollEnabled={!closing}
                  scrollEventThrottle={16}
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                  overScrollMode="never"
                >
                  {!opensFromTop ? emptyDismissArea : null}
                  <View
                    style={[
                      styles.drawerBody,
                      opensFromTop ? { paddingTop: edgePadding } : { paddingBottom: edgePadding },
                      railLayout?.body,
                    ]}
                  >
                    {!opensFromTop ? <View style={[styles.grabber, colorStyle]} /> : null}
                    {rail && railLayout && anchor ? (
                      rail.render({
                        slotSize: anchor.width,
                        railWidth: railLayout.railWidth,
                        side: rail.side,
                        opensFromTop,
                        bodyWidth: railLayout.bodyWidth,
                        close,
                      })
                    ) : (
                      <>
                        {drawerTitle}
                        <View style={styles.drawerContent}>{children}</View>
                      </>
                    )}
                    {opensFromTop ? <View style={[styles.grabber, colorStyle]} /> : null}
                  </View>
                  {opensFromTop ? emptyDismissArea : null}
                </Reanimated.ScrollView>
              )}
            </GestureDetector>
          </NativeScrollGestureContext.Provider>
          {rail ? <DrawerLayoutSwitcher /> : null}
        </Reanimated.View>
      </GestureHandlerRootView>
    </Modal>
  )
}

const styles = StyleSheet.create({
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
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.85),
  },
  drawerBody: {
    paddingHorizontal: 12,
    gap: 10,
  },
  listChrome: {
    paddingHorizontal: 12,
    gap: 10,
  },
  virtualizedContent: {
    paddingHorizontal: 12,
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
    color: theme.neutral.textPrimary,
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
    backgroundColor: theme.alpha(theme.neutral.textSecondary, 0.6),
    marginVertical: 3,
  },
})

function DrawerTitle({
  title,
  icon: IconComponent,
  iconColor,
  color,
  onPress,
}: {
  title: string | undefined
  icon: Icon | undefined
  iconColor: ThemeColor
  color: string
  onPress: () => void
}) {
  if (!title) return null
  return (
    <Pressable
      style={styles.drawerHeader}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Close ${title}`}
    >
      {IconComponent ? <IconComponent size={28} color={iconColor} weight="duotone" /> : null}
      <Text style={[styles.drawerTitle, { color }]}>{title}</Text>
    </Pressable>
  )
}

/** Measures the trigger a rail grows out of and lays the anchored body out around it. */
function useAnchoredRail(
  rail: EdgeDrawerRail | undefined,
  visible: boolean,
  triggerRef: React.RefObject<View | null>,
  opensFromTop: boolean,
) {
  const [anchor, setAnchor] = useState<TriggerLayout | null>(null)
  const { width: screenWidth, height: windowHeight } = useWindowDimensions()

  // Keyed on whether there is a rail, not on the rail object, which callers rebuild every render.
  const hasRail = rail !== undefined
  useEffect(() => {
    if (!visible || !hasRail) return
    void measureTrigger(triggerRef).then((trigger) =>
      setAnchor({ ...trigger, y: trigger.y + getModalCoordinateOffset() }),
    )
  }, [hasRail, triggerRef, visible])

  const railLayout =
    rail && anchor
      ? anchoredRailLayout(
          rail,
          anchor,
          screenWidth,
          windowHeight + getModalCoordinateOffset(),
          opensFromTop,
        )
      : null
  return { anchor, railLayout }
}

/**
 * Where an anchored rail and the content beside it go. Both sit in one row inside the scrolling
 * body, so they move as one block: the rail covers the trigger plus its outset, the content keeps
 * the same margin from the far edge, and the row ends level with the trigger once the drawer rests
 * at its content end.
 */
function anchoredRailLayout(
  rail: EdgeDrawerRail,
  anchor: TriggerLayout,
  screenWidth: number,
  screenHeight: number,
  opensFromTop: boolean,
) {
  const margin =
    rail.side === 'left'
      ? anchor.x - rail.outset
      : screenWidth - (anchor.x + anchor.width) - rail.outset
  const edgeOffset = opensFromTop
    ? anchor.y - rail.outset
    : screenHeight - (anchor.y + anchor.height) - rail.outset
  return {
    railWidth: anchor.width + rail.outset * 2,
    bodyWidth: screenWidth - margin * 2,
    body: {
      paddingHorizontal: margin,
      ...(opensFromTop ? { paddingTop: edgeOffset } : { paddingBottom: edgeOffset }),
    } satisfies ViewStyle,
  }
}
