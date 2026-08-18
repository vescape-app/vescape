import { StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'
import { useState } from 'react'

import { TextPromptModal } from '@/components/modals/TextPromptModal'
import { CommunityMessageModal } from '@/modules/release/components/CommunityMessageModal'
import type { CommunityMessage, CommunityMessageType } from 'vescape-core'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, OpenButton, ToggleRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'

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

export function CommunityMessageModalShowcase() {
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

export function TextPromptModalShowcase() {
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

export function TextPromptModalClearableShowcase() {
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

const styles = StyleSheet.create({
  previewHint: { color: theme.palette.slate.textDim, fontSize: 12, fontStyle: 'italic' },
})
