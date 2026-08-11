import { ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useEffect, useRef, useState } from 'react'

import { InfoIcon, SquaresFourIcon, UsersThreeIcon } from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { EdgeDrawer, FloatingSheet } from '@/components/overlays/AnchoredSheet'
import { useTriggerRef } from '@/components/overlays/measureTrigger'
import { IconHero } from '@/components/settings/IconHero'
import { InfoModal } from '@/components/modals/InfoModal'
import { TextPromptModal } from '@/components/modals/TextPromptModal'
import { VersionNoticeModal } from '@/modules/release/components/VersionNoticeModal'
import { CommunityMessageModal } from '@/modules/release/components/CommunityMessageModal'
import { AppBlockScreen } from '@/modules/release/components/AppBlockScreen'
import type { CommunityMessage, CommunityMessageType } from 'vescape-core'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, OpenButton, ToggleRow } from '@/components/dev/ShowcaseControls'
import { DEFAULT_ONLINE_BLOCK_MESSAGE } from '@/modules/release/constants/onlineBlock'
import { DEFAULT_UPDATE_WARNING_MESSAGE } from '@/modules/release/constants/updateWarning'
import { DEFAULT_APP_BLOCK_MESSAGE } from '@/modules/release/constants/appBlock'
import { theme } from '@/constants/theme'

function FadeCardModalShowcase() {
  const [visible, setVisible] = useState(false)
  const [dismissible, setDismissible] = useState(true)

  return (
    <ShowcaseCard
      name="FadeCardModal"
      controls={
        <>
          <ToggleRow label="dismissible" value={dismissible} onToggle={setDismissible} />
          <OpenButton onPress={() => setVisible(true)} />
        </>
      }
    >
      <Text style={styles.previewHint}>
        The shared card shell behind ConfirmModal, InfoModal and the Release surfaces
      </Text>
      <FadeCardModal
        visible={visible}
        onDismiss={dismissible ? () => setVisible(false) : undefined}
        title="Card title"
        titleIcon={InfoIcon}
        titleIconColor={theme.palette.sky.color}
        footer={<Button label="Close" onPress={() => setVisible(false)} />}
      >
        <Text style={styles.previewHint}>
          Fade + scale in, dim backdrop, optional header and close button, scrollable body, footer
          action row. Non-dismissible drops the backdrop tap, the close button and Android back.
        </Text>
      </FadeCardModal>
    </ShowcaseCard>
  )
}

function ConfirmModalShowcase() {
  const [visible, setVisible] = useState(false)
  const [destructive, setDestructive] = useState(false)

  return (
    <ShowcaseCard
      name="ConfirmModal"
      controls={
        <>
          <ToggleRow label="destructive" value={destructive} onToggle={setDestructive} />
          <OpenButton onPress={() => setVisible(true)} />
        </>
      }
    >
      <Text style={styles.previewHint}>Tap &quot;Open Modal&quot; below</Text>
      <ConfirmModal
        visible={visible}
        title={destructive ? 'Delete profile?' : 'Apply changes?'}
        message={
          destructive ? 'This action cannot be undone.' : 'New settings will be synced to board.'
        }
        confirmLabel={destructive ? 'Delete' : 'Apply'}
        destructive={destructive}
        onConfirm={() => setVisible(false)}
        onCancel={() => setVisible(false)}
      />
    </ShowcaseCard>
  )
}

function InfoModalShowcase() {
  const [visible, setVisible] = useState(false)

  return (
    <ShowcaseCard name="InfoModal" controls={<OpenButton onPress={() => setVisible(true)} />}>
      <Text style={styles.previewHint}>Tap &quot;Open Modal&quot; below</Text>
      <InfoModal
        visible={visible}
        title="Motor Temperature"
        message="Measures heat at the motor stator. High temperatures reduce magnet strength and can damage winding insulation. Keep below 150°C for longevity."
        onDismiss={() => setVisible(false)}
      />
    </ShowcaseCard>
  )
}

const SERVER_UPDATE_MESSAGE = [
  '## Update recommended',
  '',
  'A newer Vescape build is available with **improved BLE reconnect** and fresh Refloat presets.',
  '',
  '- Keeps you compatible with online features',
  '- Fixes reported ride-history gaps',
].join('\n')

function VersionNoticeModalShowcase() {
  const [visible, setVisible] = useState(false)
  const [serverMessage, setServerMessage] = useState(true)
  const [onlineBlock, setOnlineBlock] = useState(false)

  const bundled = onlineBlock ? DEFAULT_ONLINE_BLOCK_MESSAGE : DEFAULT_UPDATE_WARNING_MESSAGE

  return (
    <ShowcaseCard
      name="VersionNoticeModal"
      controls={
        <>
          <ToggleRow label="server message" value={serverMessage} onToggle={setServerMessage} />
          <ToggleRow label="online block" value={onlineBlock} onToggle={setOnlineBlock} />
          <OpenButton onPress={() => setVisible(true)} />
        </>
      }
    >
      <Text style={styles.previewHint}>
        Update Warning or Online Block, with server Markdown or the bundled default
      </Text>
      <VersionNoticeModal
        kind={onlineBlock ? 'online-block' : 'update-warning'}
        visible={visible}
        message={serverMessage ? SERVER_UPDATE_MESSAGE : bundled}
        onDismiss={() => setVisible(false)}
        onUpdate={() => setVisible(false)}
      />
    </ShowcaseCard>
  )
}

const SERVER_APP_BLOCK_MESSAGE = [
  '## This version is blocked',
  '',
  'A critical problem was found in this build. Update to keep using Vescape.',
  '',
  '- An active ride keeps recording',
  '- Your board stays connected',
].join('\n')

function AppBlockScreenShowcase() {
  const [visible, setVisible] = useState(false)
  const [serverMessage, setServerMessage] = useState(true)

  return (
    <ShowcaseCard
      name="AppBlockScreen"
      controls={
        <>
          <ToggleRow label="server message" value={serverMessage} onToggle={setServerMessage} />
          <OpenButton onPress={() => setVisible(true)} />
        </>
      }
    >
      <Text style={styles.previewHint}>
        Full-screen, non-dismissible update-only shell. In this preview the update action closes it.
      </Text>
      {visible ? (
        <AppBlockScreen
          message={serverMessage ? SERVER_APP_BLOCK_MESSAGE : DEFAULT_APP_BLOCK_MESSAGE}
          installedVersion="0.70.0"
          latestVersion="0.80.2"
          onUpdate={() => setVisible(false)}
        />
      ) : null}
    </ShowcaseCard>
  )
}

const COMMUNITY_MESSAGE_BODY = [
  '## Weekend group ride',
  '',
  'Join the **Sunday coastal loop** — casual pace, all boards welcome.',
  '',
  '- Meet 10:00 at the pier',
  '- ~18 km, one charge stop',
].join('\n')

function communityMessage(
  type: CommunityMessageType,
  withAction: boolean,
  withTitle: boolean,
): CommunityMessage {
  return {
    id: `showcase-${type}`,
    type,
    title: withTitle ? 'Weekend group ride' : null,
    body: COMMUNITY_MESSAGE_BODY,
    action: withAction
      ? {
          type: type === 'critical' ? 'primary' : 'secondary',
          label: 'Learn more',
          url: 'https://vescape.app',
        }
      : null,
  }
}

function CommunityMessageModalShowcase() {
  const [visible, setVisible] = useState(false)
  const [type, setType] = useState<CommunityMessageType>('info')
  const [withAction, setWithAction] = useState(true)
  const [withTitle, setWithTitle] = useState(true)

  return (
    <ShowcaseCard
      name="CommunityMessageModal"
      controls={
        <>
          <ChipRow
            label="type"
            options={['info', 'warning', 'critical']}
            selected={type}
            onSelect={(v) => setType(v as CommunityMessageType)}
          />
          <ToggleRow label="action" value={withAction} onToggle={setWithAction} />
          <ToggleRow label="title" value={withTitle} onToggle={setWithTitle} />
          <OpenButton onPress={() => setVisible(true)} />
        </>
      }
    >
      <Text style={styles.previewHint}>
        Info / warning / critical styling, with an optional server title and primary/secondary
        action
      </Text>
      <CommunityMessageModal
        message={visible ? communityMessage(type, withAction, withTitle) : null}
        onDismiss={() => setVisible(false)}
        onAction={() => setVisible(false)}
      />
    </ShowcaseCard>
  )
}

function TextPromptModalShowcase() {
  const [visible, setVisible] = useState(false)

  return (
    <ShowcaseCard name="TextPromptModal" controls={<OpenButton onPress={() => setVisible(true)} />}>
      <Text style={styles.previewHint}>Tap &quot;Open Modal&quot; below</Text>
      <TextPromptModal
        visible={visible}
        title="Rename board"
        placeholder="Enter new name"
        initialValue="My Board"
        confirmLabel="Rename"
        onConfirm={(value) => {
          setVisible(false)
          console.log(value)
        }}
        onDismiss={() => setVisible(false)}
      />
    </ShowcaseCard>
  )
}

/** Clearable variant: confirm stays enabled with an empty field, for optional names. */
function TextPromptModalClearableShowcase() {
  const [visible, setVisible] = useState(false)

  return (
    <ShowcaseCard
      name="TextPromptModal (clearable)"
      controls={<OpenButton onPress={() => setVisible(true)} />}
    >
      <Text style={styles.previewHint}>Tap &quot;Open Modal&quot; below</Text>
      <TextPromptModal
        visible={visible}
        title="Rename Favorite"
        placeholder="Dolina single track"
        initialValue="Dolina"
        confirmLabel="Save"
        allowEmpty
        onConfirm={(value) => {
          setVisible(false)
          console.log(value)
        }}
        onDismiss={() => setVisible(false)}
      />
    </ShowcaseCard>
  )
}

interface EdgeDrawerPositionShowcaseProps {
  edge: 'auto' | 'top' | 'bottom'
  name: string
  description: string
}

function EdgeDrawerPositionShowcase({ edge, name, description }: EdgeDrawerPositionShowcaseProps) {
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

function EdgeDrawerLongContentShowcase() {
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

function EdgeDrawerInitialFocusShowcase() {
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

function FloatingSheetShowcase() {
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

export default function ModalsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={SquaresFourIcon}
          description="FadeCardModal, ConfirmModal, InfoModal, VersionNoticeModal, CommunityMessageModal, AppBlockScreen, TextPromptModal, EdgeDrawer, FloatingSheet."
        />
        <FadeCardModalShowcase />
        <ConfirmModalShowcase />
        <InfoModalShowcase />
        <VersionNoticeModalShowcase />
        <CommunityMessageModalShowcase />
        <AppBlockScreenShowcase />
        <TextPromptModalShowcase />
        <TextPromptModalClearableShowcase />
        <EdgeDrawerPositionShowcase
          edge="auto"
          name="EdgeDrawer — automatic edge"
          description="Chooses top or bottom from the trigger's current screen position."
        />
        <EdgeDrawerPositionShowcase
          edge="top"
          name="EdgeDrawer — top edge"
          description="Always opens from the top. The complete drawer follows an upward drag."
        />
        <EdgeDrawerPositionShowcase
          edge="bottom"
          name="EdgeDrawer — bottom edge"
          description="Always opens from the bottom. The complete drawer follows a downward drag."
        />
        <EdgeDrawerLongContentShowcase />
        <EdgeDrawerInitialFocusShowcase />
        <FloatingSheetShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  previewHint: { color: theme.palette.slate.textDim, fontSize: 12, fontStyle: 'italic' },
  trigger: { alignSelf: 'flex-start' },
  tile: {
    backgroundColor: theme.palette.slate.surfaceDeep,
    borderColor: theme.palette.slate.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  tileText: { color: theme.palette.slate.textSecondary, fontSize: 14 },
  focusList: { gap: 8 },
  focusedTile: { borderColor: theme.palette.sky.color },
  article: { gap: 28, paddingHorizontal: 10, paddingBottom: 24 },
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
  articleBody: {
    color: theme.palette.slate.textSecondary,
    fontSize: 15,
    lineHeight: 24,
  },
})
