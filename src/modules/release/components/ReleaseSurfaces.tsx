import { useState } from 'react'
import { Alert } from 'react-native'

import { openAppUpdate, type CommunityMessageAction } from 'vescape-core'

import { AppBlockScreen } from '@/modules/release/components/AppBlockScreen'
import { CommunityMessageModal } from '@/modules/release/components/CommunityMessageModal'
import { VersionNoticeModal } from '@/modules/release/components/VersionNoticeModal'
import { DEFAULT_ONLINE_BLOCK_MESSAGE } from '@/modules/release/constants/onlineBlock'
import { DEFAULT_UPDATE_WARNING_MESSAGE } from '@/modules/release/constants/updateWarning'
import { acknowledgeCommunityMessage } from '@/modules/release/lib/communityMessages'
import { selectReleaseSurface, type ReleaseSurface } from '@/modules/release/lib/releaseSurface'
import { useAppStatusStore } from '@/modules/release/store/appStatusStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { openExternalUrl } from '@/components/base/openExternalUrl'

/**
 * The single mount point for every Release surface, presented one at a time in precedence order
 * (App Block, then Online Block, then Update Warning, then Community Message — see `selectReleaseSurface`). Sibling
 * modals would collide: iOS presents one modal at a time and drops the rest.
 *
 * Native owns the truth behind all three — resolved App Status (in-process) and acknowledged
 * message IDs (durable App Settings); this component only projects it and writes acknowledgements
 * back. It issues no Board Session or Ride Recording command, so active native work keeps running
 * underneath even while the app is blocked (PRD story 9).
 */
export function ReleaseSurfaces() {
  const status = useAppStatusStore((state) => state.status)
  const versionNoticeDismissed = useAppStatusStore((state) => state.versionNoticeDismissed)
  const dismissVersionNotice = useAppStatusStore((state) => state.dismissVersionNotice)
  const dismissedCommunityMessageIds = useSettingsStore(
    (state) => state.dismissedCommunityMessageIds,
  )
  const setSetting = useSettingsStore((state) => state.set)

  const surface = selectReleaseSurface({
    status,
    versionNoticeDismissed,
    dismissedCommunityMessageIds,
  })
  const { presented, exiting, finishExit } = useSequencedSurface(surface?.kind ?? null)

  const acknowledge = (id: string) => {
    // Read the freshest list at call time so a rapid second dismiss can't drop the first ID.
    const current = useSettingsStore.getState().dismissedCommunityMessageIds
    void setSetting('dismissedCommunityMessageIds', acknowledgeCommunityMessage(current, id)).catch(
      () =>
        Alert.alert('Could not dismiss message', 'The message will remain until it can be saved.'),
    )
  }

  const communityMessage = surface?.kind === 'community-message' ? surface.message : null

  const onCommunityDismiss = () => {
    if (communityMessage) acknowledge(communityMessage.id)
  }

  const onCommunityAction = (action: CommunityMessageAction) => {
    if (!communityMessage) return
    // An action acknowledges the message too — the type only drives presentation, not behavior.
    acknowledge(communityMessage.id)
    openExternalUrl(action.url, 'community_message_link')
  }

  if (presented === 'app-block' && surface?.kind === 'app-block') {
    return (
      <AppBlockScreen
        message={surface.message}
        installedVersion={surface.installedVersion}
        latestVersion={surface.latestVersion}
        onUpdate={openAppUpdate}
      />
    )
  }

  if (presented === 'online-block') {
    return (
      <VersionNoticeModal
        kind="online-block"
        visible={!exiting}
        message={surface?.kind === 'online-block' ? surface.message : DEFAULT_ONLINE_BLOCK_MESSAGE}
        onDismiss={dismissVersionNotice}
        onUpdate={openAppUpdate}
        onExited={finishExit}
      />
    )
  }

  if (presented === 'update-warning') {
    return (
      <VersionNoticeModal
        kind="update-warning"
        visible={!exiting}
        message={
          surface?.kind === 'update-warning' ? surface.message : DEFAULT_UPDATE_WARNING_MESSAGE
        }
        onDismiss={dismissVersionNotice}
        onUpdate={openAppUpdate}
        onExited={finishExit}
      />
    )
  }

  if (presented === 'community-message') {
    return (
      <CommunityMessageModal
        message={exiting ? null : communityMessage}
        onDismiss={onCommunityDismiss}
        onAction={onCommunityAction}
        onExited={finishExit}
      />
    )
  }

  return null
}

/**
 * Present one surface at a time, handing over only once the outgoing one has finished fading: a
 * modal presenting while another is still dismissing is dropped on iOS.
 *
 * Swapping the message *within* the Community Message surface is not a handover — that component
 * crossfades its own content and stays mounted.
 */
function useSequencedSurface(kind: ReleaseSurface['kind'] | null) {
  const [presented, setPresented] = useState(kind)

  // Adjusted during render: nothing is on screen to wait for, and App Block cannot animate its own
  // exit (it is also the one surface a rider can never leave), so both hand over immediately.
  if (presented !== kind && (presented === null || presented === 'app-block')) setPresented(kind)

  return {
    presented,
    /** The presented surface is on its way out; render it closed until it reports back. */
    exiting: presented !== null && presented !== kind,
    finishExit: () => setPresented(kind),
  }
}
