import { createContext, useContext } from 'react'
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  type FlatList,
  type ListRenderItem,
} from 'react-native'
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Reanimated from 'react-native-reanimated'
import type { Icon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { NativeScrollGestureContext } from '@/components/gestures/NativeScrollGestureContext'
import { useEdgeDrawerDismissal } from '@/components/overlays/useEdgeDrawerDismissal'
import { theme } from '@/constants/theme'

const EdgeDrawerScrollContext = createContext<(() => void) | null>(null)

/** Lets content deep inside a drawer scroll the drawer back to its open edge. */
export function useEdgeDrawerScrollToOpenEdge() {
  return useContext(EdgeDrawerScrollContext)
}

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

interface EdgeDrawerProps {
  visible: boolean
  triggerRef: React.RefObject<View | null>
  onClose: () => void
  /** Which edge the drawer opens from. `auto` picks the edge nearest the trigger. */
  edge?: 'auto' | 'top' | 'bottom'
  title?: string
  /** Optional glyph shown left of a centred title. */
  icon?: Icon
  iconColor?: string
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
  iconColor = theme.palette.slate.textSecondary,
  autoScrollOnContentExpand = false,
  initialFocusRef,
  onReachContentEnd,
  backdropTestID,
  children,
  virtualizedContent,
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
    scrollToOpenEdge,
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
    onClose,
    onReachContentEnd,
  })

  if (!mounted) return null

  const emptyDismissArea = (
    <Pressable style={{ height: dismissAreaHeight }} onPress={close} accessible={false} />
  )

  const drawerTitle = title ? (
    <Pressable
      style={styles.drawerHeader}
      onPress={close}
      accessibilityRole="button"
      accessibilityLabel={`Close ${title}`}
    >
      {IconComponent ? <IconComponent size={28} color={iconColor} weight="duotone" /> : null}
      <Text style={styles.drawerTitle}>{title}</Text>
    </Pressable>
  ) : null

  const listHeader = virtualizedContent ? (
    <>
      {!opensFromTop ? emptyDismissArea : null}
      <View style={[styles.listChrome, opensFromTop && { paddingTop: edgePadding }]}>
        {!opensFromTop ? <View style={styles.grabber} /> : null}
        {drawerTitle}
      </View>
    </>
  ) : null

  const listFooter = virtualizedContent ? (
    <>
      {virtualizedContent.footer}
      <View style={[styles.listChrome, opensFromTop ? undefined : { paddingBottom: edgePadding }]}>
        {opensFromTop ? <View style={styles.grabber} /> : null}
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
          <Reanimated.View style={[StyleSheet.absoluteFill, styles.drawerScrim, backdropStyle]}>
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
                    ]}
                  >
                    {!opensFromTop ? <View style={styles.grabber} /> : null}
                    {drawerTitle}
                    <EdgeDrawerScrollContext.Provider value={scrollToOpenEdge}>
                      <View style={styles.drawerContent}>{children}</View>
                    </EdgeDrawerScrollContext.Provider>
                    {opensFromTop ? <View style={styles.grabber} /> : null}
                  </View>
                  {opensFromTop ? emptyDismissArea : null}
                </Reanimated.ScrollView>
              )}
            </GestureDetector>
          </NativeScrollGestureContext.Provider>
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
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
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
