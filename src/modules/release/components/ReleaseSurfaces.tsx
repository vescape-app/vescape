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

function useSequencedSurface(kind: ReleaseSurface['kind'] | null) {
  const [presented, setPresented] = useState(kind)

  if (presented !== kind && (presented === null || presented === 'app-block')) setPresented(kind)

  return {
    presented,
    exiting: presented !== null && presented !== kind,
    finishExit: () => setPresented(kind),
  }
}
