import type { Board, BoardCandidate, BoardLink, BoardTransport } from 'vescape-core'

/** Human-readable label for a Board Transport, including the undetected case. */
export function formatBoardTransport(transport: BoardTransport | null): string {
  if (transport == null) return 'Not detected'
  if (transport === 'direct') return 'Direct'
  return `CAN id ${transport}`
}

/** Default selection from confirmed candidates: the first valid one, or null when empty. */
export function pickDefaultCandidate(candidates: BoardCandidate[]): BoardCandidate | null {
  return candidates[0] ?? null
}

/**
 * Suffix describing a Board Link's probe-detected smart-BMS presence, for appending to a
 * transport label. Empty for legacy links (`undefined`) where presence is unknown.
 */
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
  // vescFirmwareVersion is already self-labeled, e.g. "FW 6.05 · ADV500".
  if (link.vescFirmwareVersion) facts.push(link.vescFirmwareVersion)
  if (link.hasBms != null) facts.push(link.hasBms ? 'BMS' : 'no BMS')
  return facts.join(' · ')
}

/**
 * A Board needs a Board Probe before it can start a Board Session when it has no link, or when
 * its link carries no detected transport — native refuses that session with `NEEDS_LINK`, since
 * without a transport there is nothing to poll and the connect would only time out.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `startBleSession`
 */
export function boardNeedsLink(board: Pick<Board, 'link'> | undefined): boolean {
  return board?.link?.transport == null
}
