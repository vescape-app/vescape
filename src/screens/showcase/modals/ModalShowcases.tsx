import { StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'
import { useState } from 'react'

import { InfoIcon } from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { InfoModal } from '@/components/modals/InfoModal'
import { VersionNoticeModal } from '@/modules/release/components/VersionNoticeModal'
import { AppBlockScreen } from '@/modules/release/components/AppBlockScreen'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { OpenButton, ToggleRow } from '@/components/dev/ShowcaseControls'
import { DEFAULT_ONLINE_BLOCK_MESSAGE } from '@/modules/release/constants/onlineBlock'
import { DEFAULT_UPDATE_WARNING_MESSAGE } from '@/modules/release/constants/updateWarning'
import { DEFAULT_APP_BLOCK_MESSAGE } from '@/modules/release/constants/appBlock'
import { theme } from '@/constants/theme'

export function FadeCardModalShowcase() {
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

export function ConfirmModalShowcase() {
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

export function InfoModalShowcase() {
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

export function VersionNoticeModalShowcase() {
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

export function AppBlockScreenShowcase() {
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

const styles = StyleSheet.create({
  previewHint: { color: theme.palette.slate.textDim, fontSize: 12, fontStyle: 'italic' },
})
