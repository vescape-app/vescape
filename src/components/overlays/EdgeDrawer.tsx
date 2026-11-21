import { useState } from 'react'
import { BlurView } from 'expo-blur'
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
import { GrabZone, StickyChrome, useEdgeDrawerChrome } from '@/components/overlays/EdgeDrawerChrome'
import { useEdgeDrawerDismissal } from '@/components/overlays/useEdgeDrawerDismissal'
import { useDrawerBlurTarget } from '@/components/overlays/DrawerBlurProvider'
import {
  useWidgetFocusHost,
  WidgetFocusOverlay,
  WidgetFocusProvider,
} from '@/components/overlays/widgetFocus'
import { theme, type ThemeColor } from '@/constants/theme'
import { useResolvedNeutralColors, useThemeStore } from '@/hooks/useTheme'

interface EdgeDrawerVirtualizedContent {
  getItemLayout?: FlatListProps<unknown>['getItemLayout']
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
  onBack?: () => void
  edge?: 'auto' | 'top' | 'bottom'
  header?: React.ReactNode
  stickyFooter?: React.ReactNode
  title?: string
  icon?: Icon
  iconColor?: ThemeColor
  autoScrollOnContentExpand?: boolean
  contentPageKey?: string
  initialFocusRef?: React.RefObject<View | null>
  onReachContentEnd?: () => void
  keyboardShouldPersistTaps?: React.ComponentProps<
    typeof Reanimated.ScrollView
  >['keyboardShouldPersistTaps']
  backdropTestID?: string
  testID?: string
  children?: React.ReactNode
  virtualizedContent?: EdgeDrawerVirtualizedContent
}

export function EdgeDrawer({
  visible,
  triggerRef,
  onClose,
  onBack,
  edge = 'bottom',
  title,
  header,
  stickyFooter,
  icon: IconComponent,
  iconColor = theme.neutral.textSecondary,
  autoScrollOnContentExpand = false,
  contentPageKey,
  initialFocusRef,
  onReachContentEnd,
  backdropTestID,
  keyboardShouldPersistTaps,
  testID,
  children,
  virtualizedContent,
}: EdgeDrawerProps) {
  const [listHeaderHeight, setListHeaderHeight] = useState(0)
  const [chromeHeights, setChromeHeights] = useState({ leading: 0, trailing: 0 })
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
    handleScrollBeginDrag,
    chromeDrag,
    dismissTriggered,
    scrollOffset,
    animatedDismissRange,
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

  const chrome = useEdgeDrawerChrome({
    opensFromTop,
    scrollOffset,
    dismissRange: animatedDismissRange,
    edgePadding,
    chromeDrag,
    dismissTriggered,
    nativeScrollGesture,
    close,
  })

  const focus = useWidgetFocusHost()
  const { rootRef: focusRootRef, active: focusActive, controller: focusController } = focus
  const neutral = useResolvedNeutralColors()
  const blurTint = useThemeStore((state) => state.resolvedTheme)
  const { blurTarget, canBlur } = useDrawerBlurTarget()

  if (!mounted) return null

  const emptyDismissArea = (
    <Pressable
      testID={backdropTestID}
      style={{ height: dismissAreaHeight }}
      onPress={close}
      accessible={false}
    />
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

  const overlay = virtualizedContent != null
  const { leadingChrome, trailingChrome } = drawerChrome({
    chrome,
    overlay,
    opensFromTop,
    edgePadding,
    title: drawerTitle,
    stickyFooter,
    neutral,
    setChromeHeights,
  })

  const scrimStyle: StyleProp<ViewStyle> = {
    backgroundColor: theme.alpha(neutral.surfaceDeep, 0.7),
  }

  const listHeader = virtualizedContent ? (
    <View onLayout={(event) => setListHeaderHeight(event.nativeEvent.layout.height)}>
      {!opensFromTop ? emptyDismissArea : null}
      <View style={[styles.listChrome, { height: chromeHeights.leading }]} />
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
      <View
        style={[
          styles.listChrome,
          { height: trailingChrome ? chromeHeights.trailing : 0 },
          opensFromTop ? undefined : { marginBottom: edgePadding },
        ]}
      />
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
      onRequestClose={focusActive ? focusController.close : (onBack ?? close)}
      onShow={startOpen}
    >
      <GestureHandlerRootView testID={testID} style={styles.modalGestureRoot}>
        <View style={styles.drawer}>
          <Reanimated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            {canBlur ? (
              <BlurView
                pointerEvents="none"
                style={StyleSheet.absoluteFill}
                blurTarget={blurTarget}
                blurMethod="dimezisBlurViewSdk31Plus"
                intensity={40}
                tint={blurTint}
              />
            ) : null}
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, scrimStyle]} />
            <Pressable style={StyleSheet.absoluteFill} onPress={close} />
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
                    ListHeaderComponentStyle={styles.stickyCell}
                    ListFooterComponentStyle={styles.stickyCell}
                    removeClippedSubviews={false}
                    ListEmptyComponent={virtualizedContent.empty}
                    ListFooterComponent={listFooter}
                    ItemSeparatorComponent={virtualizedContent.separator}
                    contentContainerStyle={styles.virtualizedContent}
                    onEndReached={virtualizedContent.onEndReached}
                    onEndReachedThreshold={virtualizedContent.onEndReachedThreshold ?? 0.6}
                    onContentSizeChange={handleContentSizeChange}
                    onScroll={scrollHandler}
                    onScrollBeginDrag={handleScrollBeginDrag}
                    onScrollEndDrag={handleScrollEndDrag}
                    onMomentumScrollEnd={handleScrollEnd}
                    scrollEnabled={!closing && !focusActive}
                    scrollEventThrottle={16}
                    showsVerticalScrollIndicator={false}
                    bounces={false}
                    scrollsToTop={false}
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
                    keyboardShouldPersistTaps={keyboardShouldPersistTaps}
                    onContentSizeChange={handleContentSizeChange}
                    onScroll={scrollHandler}
                    onScrollBeginDrag={handleScrollBeginDrag}
                    onScrollEndDrag={handleScrollEndDrag}
                    onMomentumScrollEnd={handleScrollEnd}
                    scrollEnabled={!closing && !focusActive}
                    scrollEventThrottle={16}
                    showsVerticalScrollIndicator={false}
                    bounces={false}
                    scrollsToTop={false}
                    overScrollMode="never"
                  >
                    {!opensFromTop ? emptyDismissArea : null}
                    <View
                      style={[
                        styles.drawerBody,
                        opensFromTop ? undefined : { paddingBottom: edgePadding },
                      ]}
                    >
                      {leadingChrome}
                      <WidgetFocusProvider host={focus}>
                        <View style={styles.drawerContent}>{children}</View>
                      </WidgetFocusProvider>
                      {trailingChrome}
                    </View>
                    {opensFromTop ? emptyDismissArea : null}
                  </Reanimated.ScrollView>
                )}
              </GestureDetector>
            </NativeScrollGestureContext.Provider>
            {overlay ? leadingChrome : null}
            {overlay ? trailingChrome : null}
            <GrabZone {...chrome.grabZone} testID={testID ? `${testID}-grabber` : undefined} />
            <WidgetFocusOverlay host={focus} />
          </View>
        </Reanimated.View>
      </GestureHandlerRootView>
    </Modal>
  )
}

function drawerChrome({
  chrome,
  overlay,
  opensFromTop,
  edgePadding,
  title,
  stickyFooter,
  neutral,
  setChromeHeights,
}: {
  chrome: ReturnType<typeof useEdgeDrawerChrome>
  overlay: boolean
  opensFromTop: boolean
  edgePadding: number
  title: React.ReactNode
  stickyFooter: React.ReactNode
  neutral: ReturnType<typeof useResolvedNeutralColors>
  setChromeHeights: React.Dispatch<React.SetStateAction<{ leading: number; trailing: number }>>
}) {
  const grabber = <View style={[styles.grabber, colorStyleFor(neutral.textSecondary)]} />
  const leadingChrome = (
    <StickyChrome
      {...chrome.leading}
      overlay={overlay}
      onHeight={(leading) => setChromeHeights((heights) => ({ ...heights, leading }))}
      background={neutral.surfaceDeep}
      style={opensFromTop ? { paddingTop: edgePadding } : undefined}
    >
      {!opensFromTop ? grabber : null}
      {title}
    </StickyChrome>
  )
  const trailingChrome =
    stickyFooter || opensFromTop ? (
      <StickyChrome
        {...chrome.trailing}
        overlay={overlay}
        onHeight={(trailing) => setChromeHeights((heights) => ({ ...heights, trailing }))}
        background={neutral.surfaceDeep}
      >
        {stickyFooter}
        {opensFromTop ? grabber : null}
      </StickyChrome>
    ) : null

  return { leadingChrome, trailingChrome }
}

function colorStyleFor(color: string): ViewStyle {
  return { backgroundColor: theme.alpha(color, 0.6) }
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
  stickyCell: {
    zIndex: 1,
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
