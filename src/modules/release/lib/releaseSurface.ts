import type { AppStatus, CommunityMessage } from 'vescape-core'

import { DEFAULT_APP_BLOCK_MESSAGE } from '@/modules/release/constants/appBlock'
import { DEFAULT_ONLINE_BLOCK_MESSAGE } from '@/modules/release/constants/onlineBlock'
import { DEFAULT_UPDATE_WARNING_MESSAGE } from '@/modules/release/constants/updateWarning'
import { currentCommunityMessage } from '@/modules/release/lib/communityMessages'

export type ReleaseSurface =
  | { kind: 'app-block'; message: string; installedVersion: string; latestVersion: string }
  | { kind: 'online-block'; message: string }
  | { kind: 'update-warning'; message: string }
  | { kind: 'community-message'; message: CommunityMessage }

export interface ReleaseSurfaceInputs {
  status: AppStatus | null
  versionNoticeDismissed: boolean
  dismissedCommunityMessageIds: string[]
}

export function selectReleaseSurface(inputs: ReleaseSurfaceInputs): ReleaseSurface | null {
  const version = inputs.status?.version

  if (version?.status === 'app-blocked') {
    return {
      kind: 'app-block',
      message: version.message ?? DEFAULT_APP_BLOCK_MESSAGE,
      installedVersion: version.installed,
      latestVersion: version.latest,
    }
  }

  if (version?.status === 'online-blocked' && !inputs.versionNoticeDismissed) {
    return { kind: 'online-block', message: version.message ?? DEFAULT_ONLINE_BLOCK_MESSAGE }
  }

  if (version?.status === 'update-warning' && !inputs.versionNoticeDismissed) {
    return { kind: 'update-warning', message: version.message ?? DEFAULT_UPDATE_WARNING_MESSAGE }
  }

  const message = currentCommunityMessage(
    inputs.status?.messages ?? [],
    inputs.dismissedCommunityMessageIds,
  )
  return message ? { kind: 'community-message', message } : null
}
