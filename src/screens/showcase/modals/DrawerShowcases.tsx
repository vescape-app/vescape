import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { useEffect, useRef, useState } from 'react'

import { UsersThreeIcon } from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { FloatingSheet } from '@/components/overlays/AnchoredSheet'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { useTriggerRef } from '@/components/overlays/measureTrigger'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { OpenButton } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'

interface EdgeDrawerPositionShowcaseProps {
  edge: 'auto' | 'top' | 'bottom'
  name: string
  description: string
}

export function EdgeDrawerPositionShowcase({
  edge,
  name,
  description,
}: EdgeDrawerPositionShowcaseProps) {
  const triggerRef = useTriggerRef()
  const [visible, setVisible] = useState(false)
  const dragInstruction =
    edge === 'top'
      ? 'Scroll to the end, then continue upward to move the whole drawer out.'
      : edge === 'bottom'
        ? 'At the top of the list, drag downward to move the whole drawer out.'
        : 'Scroll to the dismiss-side edge, then continue dragging to move the whole drawer out.'

  return (
    <ShowcaseCard
      name={name}
      controls={
        <View ref={triggerRef} collapsable={false} style={styles.trigger}>
          <OpenButton label={`Open ${edge}`} onPress={() => setVisible(true)} />
        </View>
      }
    >
      <Text style={styles.previewHint}>{description}</Text>
      <EdgeDrawer
        visible={visible}
        triggerRef={triggerRef}
        edge={edge}
        title={`${edge[0].toUpperCase()}${edge.slice(1)} drawer`}
        icon={UsersThreeIcon}
        onClose={() => setVisible(false)}
      >
        <View style={styles.tile}>
          <Text style={styles.tileText}>{dragInstruction}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileText}>Release early to test spring-back.</Text>
        </View>
      </EdgeDrawer>
    </ShowcaseCard>
  )
}

const LONG_CONTENT_SECTIONS = [
  {
    title: 'How the gesture works',
    body: 'This drawer contains ordinary text instead of a stack of controls. Scroll it exactly like a regular scroll view. The content should remain under your finger and preserve normal momentum.',
  },
  {
    title: 'Scrolling through content',
    body: 'While there is more text below, vertical gestures belong to the content. The surrounding drawer remains fixed in place. Slow drags, quick flicks, and stopping midway should all behave like normal list scrolling.',
  },
  {
    title: 'Reaching the boundary',
    body: 'At the end of the article there is nowhere left for the content to scroll. Keep dragging toward the edge the drawer opened from and the gesture transfers to the complete drawer instead.',
  },
  {
    title: 'Moving the window',
    body: 'After the transfer, the title, text, grabber, and backdrop move together. The drawer tracks the finger directly rather than waiting for a swipe threshold before showing any movement.',
  },
  {
    title: 'Fling behavior',
    body: 'Release with enough velocity and the drawer continues off-screen. Release early with little velocity and it returns to its open position. This is the same interaction model used by system notification panels.',
  },
  {
    title: 'End of example',
    body: 'You are now at the dismiss boundary. Keep dragging to push the entire window out of view and close it.',
  },
] as const

/** Enough repeats that the article is several screens tall on a phone, not barely one. */
const LONG_CONTENT_PASSES = 4
const LONG_CONTENT_ARTICLE = Array.from({ length: LONG_CONTENT_PASSES }, (_pass, passIndex) =>
  LONG_CONTENT_SECTIONS.map((section) => ({
    key: `${passIndex}-${section.title}`,
    ...section,
  })),
).flat()

export function EdgeDrawerLongContentShowcase() {
  const triggerRef = useTriggerRef()
  const [visible, setVisible] = useState(false)

  return (
    <ShowcaseCard
      name="EdgeDrawer — long scrolling content"
      controls={
        <View ref={triggerRef} collapsable={false} style={styles.trigger}>
          <OpenButton label="Open long content" onPress={() => setVisible(true)} />
        </View>
      }
    >
      <Text style={styles.previewHint}>
        Regular text scrolls first; a drag at the end moves the complete drawer out.
      </Text>
      <EdgeDrawer
        visible={visible}
        triggerRef={triggerRef}
        title="Gesture guide"
        onClose={() => setVisible(false)}
      >
        <View style={styles.article}>
          <Text style={styles.articleLead}>
            Scroll this full article, then continue the same motion at the end.
          </Text>
          {LONG_CONTENT_ARTICLE.map((section) => (
            <View key={section.key} style={styles.articleSection}>
              <Text style={styles.articleTitle}>{section.title}</Text>
              <Text style={styles.articleBody}>{section.body}</Text>
            </View>
          ))}
        </View>
      </EdgeDrawer>
    </ShowcaseCard>
  )
}

const VIRTUALIZED_ROWS = Array.from({ length: 100 }, (_, index) => ({
  id: `virtualized-${index}`,
  label: `Virtualized row ${index + 1}`,
}))

export function EdgeDrawerVirtualizedShowcase() {
  const triggerRef = useTriggerRef()
  const [visible, setVisible] = useState(false)

  return (
    <ShowcaseCard
      name="EdgeDrawer — virtualized list"
      controls={
        <View ref={triggerRef} collapsable={false} style={styles.trigger}>
          <OpenButton label="Open 100 rows" onPress={() => setVisible(true)} />
        </View>
      }
    >
      <Text style={styles.previewHint}>FlatList path for long lists and early pagination.</Text>
      <EdgeDrawer
        visible={visible}
        triggerRef={triggerRef}
        title="Virtualized rows"
        onClose={() => setVisible(false)}
        virtualizedContent={{
          data: VIRTUALIZED_ROWS,
          keyExtractor: (item) => (item as (typeof VIRTUALIZED_ROWS)[number]).id,
          renderItem: ({ item }) => (
            <View style={styles.tile}>
              <Text style={styles.tileText}>
                {(item as (typeof VIRTUALIZED_ROWS)[number]).label}
              </Text>
            </View>
          ),
          separator: VirtualizedRowSeparator,
        }}
      />
    </ShowcaseCard>
  )
}

function VirtualizedRowSeparator() {
  return <View style={styles.virtualizedSeparator} />
}

export function EdgeDrawerInitialFocusShowcase() {
  const triggerRef = useTriggerRef()
  const focusedRowRef = useRef<View>(null)
  const [visible, setVisible] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => setExpanded(true), 300)
    return () => clearTimeout(timer)
  }, [visible])

  return (
    <ShowcaseCard
      name="EdgeDrawer — initial focus"
      controls={
        <View
          ref={triggerRef}
          collapsable={false}
          testID="edge-drawer-focus-open"
          style={styles.trigger}
        >
          <OpenButton
            label="Open focused content"
            onPress={() => {
              setExpanded(false)
              setVisible(true)
            }}
          />
        </View>
      }
    >
      <Text style={styles.previewHint}>
        A long bottom drawer opens with row 1 inside the visible area. Automatic close remains
        committed if another gesture reaches the drawer while it is moving.
      </Text>
      <EdgeDrawer
        visible={visible}
        triggerRef={triggerRef}
        edge="bottom"
        title={expanded ? 'Focused list expanded' : 'Focused list'}
        initialFocusRef={focusedRowRef}
        onClose={() => setVisible(false)}
      >
        <Button
          label="Close automatically"
          variant="secondary"
          size="sm"
          onPress={() => setVisible(false)}
        />
        <View style={styles.focusList}>
          {Array.from({ length: expanded ? 24 : 12 }, (_, index) => {
            const focused = index === 0
            return (
              <View
                ref={focused ? focusedRowRef : undefined}
                key={index}
                style={[styles.tile, focused && styles.focusedTile]}
              >
                <Text
                  testID={focused ? 'edge-drawer-focused-row' : undefined}
                  style={styles.tileText}
                >
                  {focused ? 'Selected row 1' : `Row ${index + 1}`}
                </Text>
              </View>
            )
          })}
        </View>
      </EdgeDrawer>
    </ShowcaseCard>
  )
}

export function FloatingSheetShowcase() {
  const triggerRef = useTriggerRef()
  const [visible, setVisible] = useState(false)

  return (
    <ShowcaseCard
      name="FloatingSheet"
      controls={
        <View ref={triggerRef} collapsable={false} style={styles.trigger}>
          <OpenButton onPress={() => setVisible(true)} />
        </View>
      }
    >
      <Text style={styles.previewHint}>Compact popover centered under its trigger</Text>
      <FloatingSheet
        visible={visible}
        triggerRef={triggerRef}
        matchTriggerWidth={false}
        minWidth={220}
        onClose={() => setVisible(false)}
      >
        <View style={styles.tile}>
          <Text style={styles.tileText}>Option one</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileText}>Option two</Text>
        </View>
      </FloatingSheet>
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  article: { gap: 28, paddingHorizontal: 10, paddingBottom: 24 },
  articleBody: {
    color: theme.palette.slate.textSecondary,
    fontSize: 15,
    lineHeight: 24,
  },
  articleLead: {
    color: theme.palette.slate.textPrimary,
    fontSize: 18,
    lineHeight: 27,
    fontWeight: '600',
  },
  articleSection: { gap: 8 },
  articleTitle: {
    color: theme.palette.slate.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  focusList: { gap: 8 },
  focusedTile: { borderColor: theme.palette.sky.color },
  previewHint: { color: theme.palette.slate.textDim, fontSize: 12, fontStyle: 'italic' },
  tile: {
    backgroundColor: theme.palette.slate.surfaceDeep,
    borderColor: theme.palette.slate.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  tileText: { color: theme.palette.slate.textSecondary, fontSize: 14 },
  trigger: { alignSelf: 'flex-start' },
  virtualizedSeparator: { height: 8 },
})
