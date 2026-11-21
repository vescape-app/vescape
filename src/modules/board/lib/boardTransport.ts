import type { Board, BoardCandidate, BoardLink, BoardTransport } from 'vescape-core'

export function formatBoardTransport(transport: BoardTransport | null): string {
  if (transport == null) return 'Not detected'
  if (transport === 'direct') return 'Direct'
  return `CAN id ${transport}`
}

export function pickDefaultCandidate(candidates: BoardCandidate[]): BoardCandidate | null {
  return candidates[0] ?? null
}

export function formatBmsSuffix(hasBms: boolean | undefined): string {
  if (hasBms === true) return ' · BMS'
  if (hasBms === false) return ' · no BMS'
  return ''
}

export function formatCandidateTransport(transport: BoardTransport): string {
  if (transport === 'direct') return 'Direct'
  return `CAN ${transport}`
}

export function formatRefloatIdentity({
  refloatVersion,
  refloatBaseVersion,
}: Pick<BoardCandidate | BoardLink, 'refloatVersion' | 'refloatBaseVersion'>): string | null {
  if (refloatVersion && refloatBaseVersion && refloatVersion !== refloatBaseVersion) {
    return `${refloatVersion} · base ${refloatBaseVersion}`
  }
  return refloatVersion ?? (refloatBaseVersion ? `Refloat base ${refloatBaseVersion}` : null)
}

export function formatBoardLinkFacts(link: BoardLink): string {
  const facts = [
    link.linkVersion === 4 ? 'Board Link v4' : 'Legacy Board Link',
    link.bleId,
    formatBoardTransport(link.transport),
  ]
  const refloat = formatRefloatIdentity(link)
  if (refloat) facts.push(refloat)
  if (link.vescFirmwareVersion) facts.push(link.vescFirmwareVersion)
  if (link.hasBms != null) facts.push(link.hasBms ? 'BMS' : 'no BMS')
  return facts.join(' · ')
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `startBleSession`
 */
export function boardNeedsLink(board: Pick<Board, 'link'> | undefined): boolean {
  return board?.link?.transport == null
}
