import { describe, expect, it } from 'bun:test'
import type { Board } from 'vescape-core'

import {
  boardNeedsLink,
  formatBoardLinkFacts,
  formatBoardTransport,
  formatCandidateTransport,
  formatRefloatIdentity,
  pickDefaultCandidate,
} from '@/modules/board/lib/boardTransport'

describe('formatBoardTransport', () => {
  it('labels an undetected transport', () => {
    expect(formatBoardTransport(null)).toBe('Not detected')
  })

  it('labels a direct transport', () => {
    expect(formatBoardTransport('direct')).toBe('Direct')
  })

  it('labels a CAN-forwarded transport with its id', () => {
    expect(formatBoardTransport(0)).toBe('CAN id 0')
    expect(formatBoardTransport(36)).toBe('CAN id 36')
  })
})

describe('formatCandidateTransport', () => {
  it('uses compact picker labels', () => {
    expect(formatCandidateTransport('direct')).toBe('Direct')
    expect(formatCandidateTransport(84)).toBe('CAN 84')
  })
})

describe('formatRefloatIdentity', () => {
  it('shows full Refloat identity with normalized base when both are known', () => {
    expect(
      formatRefloatIdentity({
        refloatVersion: 'Refloat 1.3.0-preview2',
        refloatBaseVersion: '1.3.0',
      }),
    ).toBe('Refloat 1.3.0-preview2 · base 1.3.0')
  })

  it('returns null when firmware identity is missing', () => {
    expect(formatRefloatIdentity({})).toBeNull()
  })
})

describe('formatBoardLinkFacts', () => {
  it('shows compact Board Link v3 facts', () => {
    expect(
      formatBoardLinkFacts({
        linkVersion: 3,
        bleId: 'AA:BB',
        transport: 84,
        hasBms: false,
        // Native reports the firmware self-labeled, e.g. "FW 6.05 · ADV500".
        vescFirmwareVersion: 'FW 6.05 · ADV500',
        refloatVersion: 'Refloat 1.3.0-preview2',
        refloatBaseVersion: '1.3.0',
      }),
    ).toBe(
      'Board Link v3 · AA:BB · CAN id 84 · Refloat 1.3.0-preview2 · base 1.3.0 · FW 6.05 · ADV500 · no BMS',
    )
  })
})

describe('pickDefaultCandidate', () => {
  it('returns null when there are no candidates', () => {
    expect(pickDefaultCandidate([])).toBeNull()
  })

  it('picks the first candidate in probe order', () => {
    const direct = { transport: 'direct' as const, hasBms: true }
    const can = { transport: 36, hasBms: false }
    expect(pickDefaultCandidate([direct, can])).toBe(direct)
    expect(pickDefaultCandidate([can, direct])).toBe(can)
  })
})

describe('boardNeedsLink', () => {
  it('needs a link only when the board has none', () => {
    expect(boardNeedsLink(undefined)).toBe(true)
    expect(boardNeedsLink({ link: null })).toBe(true)
    expect(boardNeedsLink({ link: { bleId: 'AA', transport: 'direct' } })).toBe(false)
    expect(boardNeedsLink({ link: { bleId: 'AA', transport: 36 } })).toBe(false)
  })

  // The BoardLink type promises a transport, but persisted links predate that promise: native
  // builds SessionConfig.transport via BoardTransport.fromBridge, which decodes a missing or junk
  // value to null and then refuses the session with NEEDS_LINK. Route those to re-linking rather
  // than to a connect that can only time out.
  it('needs a link when the persisted link carries no detected transport', () => {
    const corrupt = { link: { bleId: 'AA' } } as unknown as Pick<Board, 'link'>
    expect(boardNeedsLink(corrupt)).toBe(true)
  })
})
