import type { CommunityMessage, CommunityMessageType } from 'vescape-core'

const TYPE_PRIORITY: Record<CommunityMessageType, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

function isRenderableMessage(message: CommunityMessage): boolean {
  const action = message?.action
  return (
    typeof message?.id === 'string' &&
    message.id.length > 0 &&
    typeof message.body === 'string' &&
    message.body.length > 0 &&
    message.type in TYPE_PRIORITY &&
    (action === null ||
      (typeof action === 'object' &&
        (action.type === 'primary' || action.type === 'secondary') &&
        typeof action.label === 'string' &&
        action.label.length > 0 &&
        typeof action.url === 'string' &&
        action.url.length > 0))
  )
}

export function communityMessageQueue(
  messages: CommunityMessage[],
  dismissedIds: string[],
): CommunityMessage[] {
  const dismissed = new Set(dismissedIds)
  return messages
    .filter((message) => isRenderableMessage(message) && !dismissed.has(message.id))
    .sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type])
}

export function currentCommunityMessage(
  messages: CommunityMessage[],
  dismissedIds: string[],
): CommunityMessage | null {
  return communityMessageQueue(messages, dismissedIds)[0] ?? null
}

export const MAX_DISMISSED_IDS = 10

export function acknowledgeCommunityMessage(dismissedIds: string[], id: string): string[] {
  if (dismissedIds.includes(id)) return dismissedIds
  return [...dismissedIds, id].slice(-MAX_DISMISSED_IDS)
}
