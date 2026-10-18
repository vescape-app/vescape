import { useState } from 'react'
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  type FlatList,
  type ListRenderItem,
  type FlatListProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Reanimated from 'react-native-reanimated'
import type { Icon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { NativeScrollGestureContext } from '@/components/gestures/NativeScrollGestureContext'
import { useEdgeDrawerDismissal } from '@/components/overlays/useEdgeDrawerDismissal'
import {
  useWidgetFocusHost,
  WidgetFocusOverlay,
  WidgetFocusProvider,
} from '@/components/overlays/widgetFocus'
import { theme, type ThemeColor } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

interface EdgeDrawerVirtualizedContent {
  /** Exact data-row frames allow scrolling to rows outside the render window. */
  getItemLayout?: FlatListProps<unknown>['getItemLayout']
  /** Focus rectangle relative to the first data row (the drawer adds its header). */
  initialFocus?: { offset: number; height: number }
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
  /** Custom interactive header, replacing the default title and icon. */
  header?: React.ReactNode
  title?: string
  /** Optional glyph shown left of a centred title. */
  icon?: Icon
  iconColor?: ThemeColor
  /** Scroll newly expanded content into view when the drawer grows. */
  autoScrollOnContentExpand?: boolean
  /** Return to the start of the drawer content when switching between pages. */
  contentPageKey?: string
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
  header,
  icon: IconComponent,
  iconColor = theme.neutral.textSecondary,
  autoScrollOnContentExpand = false,
  contentPageKey,
  initialFocusRef,
  onReachContentEnd,
  backdropTestID,
  children,
  virtualizedContent,
}: EdgeDrawerProps) {
  const [listHeaderHeight, setListHeaderHeight] = useState(0)
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
    virtualized: virtualizedContent != null,
    initialFocusLayout: listFocusLayout(listHeaderHeight, virtualizedContent?.initialFocus),
    autoScrollOnContentExpand,
    contentPageKey,
    onClose,
    onReachContentEnd,
  })

  const focus = useWidgetFocusHost()
  const { rootRef: focusRootRef, active: focusActive, controller: focusController } = focus
  // JS-side resolution: baked adaptive tokens in a StyleSheet go stale inside a live Modal window
  // after the rider changes the appearance in place — the window re-resolves only on remount.
  const neutral = useResolvedNeutralColors()

  if (!mounted) return null

  const emptyDismissArea = (
    <Pressable style={{ height: dismissAreaHeight }} onPress={close} accessible={false} />
  )

  const drawerTitle = header ? (
    <View style={styles.drawerHeader}>{header}</View>
  ) : title ? (
    <Pressable
      style={styles.drawerHeader}
      onPress={close}
      accessibilityRole="button"
      accessibilityLabel={`Close ${title}`}
    >
      {IconComponent ? <IconComponent size={28} color={iconColor} weight="duotone" /> : null}
      <Text style={[styles.drawerTitle, { color: neutral.textPrimary }]}>{title}</Text>
    </Pressable>
  ) : null

  const scrimStyle: StyleProp<ViewStyle> = {
    backgroundColor: theme.alpha(neutral.surfaceDeep, 0.85),
  }
  const colorStyle: StyleProp<ViewStyle> = {
    backgroundColor: theme.alpha(neutral.textSecondary, 0.6),
  }

  const listHeader = virtualizedContent ? (
    <View onLayout={(event) => setListHeaderHeight(event.nativeEvent.layout.height)}>
      {!opensFromTop ? emptyDismissArea : null}
      <View style={[styles.listChrome, opensFromTop && { paddingTop: edgePadding }]}>
        {!opensFromTop ? <View style={[styles.grabber, colorStyle]} /> : null}
        {drawerTitle}
      </View>
    </View>
  ) : null

  const listFooter = virtualizedContent ? (
    <>
      {virtualizedContent.footer}
      <VirtualizedFocusFooter
        focus={virtualizedContent.initialFocus}
        opensFromTop={opensFromTop}
        height={dismissAreaHeight}
      />
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
      onRequestClose={focusActive ? focusController.close : close}
      onShow={startOpen}
    >
      <GestureHandlerRootView style={styles.modalGestureRoot}>
        <View style={styles.drawer}>
          <Reanimated.View style={[StyleSheet.absoluteFill, scrimStyle, backdropStyle]}>
            <Pressable testID={backdropTestID} style={StyleSheet.absoluteFill} onPress={close} />
          </Reanimated.View>
        </View>
        <Reanimated.View style={[styles.drawer, presenceStyle]}>
          <View ref={focusRootRef} collapsable={false} style={styles.focusRoot}>
            <NativeScrollGestureContext.Provider value={nativeScrollGesture}>
              <GestureDetector gesture={nativeScrollGesture}>
                {virtualizedContent ? (
                  <Reanimated.FlatList
                    ref={scrollRef as React.RefObject<FlatList<unknown>>}
                    data={virtualizedContent.data as unknown[]}
                    renderItem={virtualizedContent.renderItem}
                    keyExtractor={virtualizedContent.keyExtractor}
                    getItemLayout={withListHeaderLayout(
                      virtualizedContent.getItemLayout,
                      listHeaderHeight,
                    )}
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
                    scrollEnabled={!closing && !focusActive}
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
                    scrollEnabled={!closing && !focusActive}
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
                      {!opensFromTop ? <View style={[styles.grabber, colorStyle]} /> : null}
                      {drawerTitle}
                      <WidgetFocusProvider host={focus}>
                        <View style={styles.drawerContent}>{children}</View>
                      </WidgetFocusProvider>
                      {opensFromTop ? <View style={[styles.grabber, colorStyle]} /> : null}
                    </View>
                    {opensFromTop ? emptyDismissArea : null}
                  </Reanimated.ScrollView>
                )}
              </GestureDetector>
            </NativeScrollGestureContext.Provider>
            <WidgetFocusOverlay host={focus} />
          </View>
        </Reanimated.View>
      </GestureHandlerRootView>
    </Modal>
  )
}

function listFocusLayout(
  headerHeight: number,
  focus: EdgeDrawerVirtualizedContent['initialFocus'],
) {
  if (!focus || headerHeight <= 0) return undefined
  return { offset: headerHeight + focus.offset, height: focus.height }
}

function withListHeaderLayout(
  getLayout: EdgeDrawerVirtualizedContent['getItemLayout'],
  headerHeight: number,
): EdgeDrawerVirtualizedContent['getItemLayout'] {
  if (!getLayout) return undefined
  return (data, index) => {
    const layout = getLayout(data, index)
    return { ...layout, offset: headerHeight + layout.offset }
  }
}

/** Let even the final selected row reach the screen center. */
function VirtualizedFocusFooter({
  focus,
  opensFromTop,
  height,
}: {
  focus: EdgeDrawerVirtualizedContent['initialFocus']
  opensFromTop: boolean
  height: number
}) {
  return focus && !opensFromTop ? <View style={{ height: height / 2 }} /> : null
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
  focusRoot: {
    flex: 1,
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
