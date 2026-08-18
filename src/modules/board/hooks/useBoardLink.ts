import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addBoardProbeProgressListener,
  cancelBoardProbe,
  probeBoardLink,
  type BoardCandidate,
  type BoardLink,
  type BoardProbeProgressEvent,
} from 'vescape-core'

import { pickDefaultCandidate } from '@/modules/board/lib/boardTransport'
import { useBleStore } from '@/modules/board/store/bleStore'

/**
 * UI-facing phase of a linking run. "linking" covers the live connect/probe
 * sequence; "picking" exposes the confirmed transports; "failed" means no
 * transport returned telemetry. The underlying domain operation is a Board Probe
 * (see CONTEXT.md) — the UI just calls it "linking".
 */
export type BoardLinkPhase = 'linking' | 'picking' | 'failed'

export interface UseBoardLink {
  phase: BoardLinkPhase
  candidates: BoardCandidate[]
  selected: BoardCandidate | null
  progress: BoardProbeProgressEvent | null
  /** Draft Board Link for the current selection, or null while linking/failed. */
  selectedLink: BoardLink | null
  select: (candidate: BoardCandidate) => void
  retry: () => void
}

/**
 * Drives a Board Probe of one BLE peripheral: ends any live Board Session, runs
 * the native probe, and tracks live progress plus the confirmed candidates and
 * the rider's pick. Persistence (saving or clearing a Board Link) is the
 * caller's responsibility — this hook only resolves a draft link.
 */
export function useBoardLink(bleId: string | null): UseBoardLink {
  const [phase, setPhase] = useState<BoardLinkPhase>('linking')
  const [candidates, setCandidates] = useState<BoardCandidate[]>([])
  const [selected, setSelected] = useState<BoardCandidate | null>(null)
  const [progress, setProgress] = useState<BoardProbeProgressEvent | null>(null)
  const runRef = useRef(0)
  const activeProbeIdRef = useRef<string | null>(null)

  const runProbe = useCallback(() => {
    // A missing peripheral isn't probeable; callers handle the no-device case in
    // their UI, so there's nothing to run here.
    if (!bleId) return
    const run = ++runRef.current
    const probeId = `${bleId}:${run}:${Date.now()}`
    activeProbeIdRef.current = probeId
    // End any live Board Session before probing so the probe owns the BLE link.
    void useBleStore
      .getState()
      .disconnect()
      .then(() => {
        if (run !== runRef.current) throw new Error('Board probe superseded before start')
        return probeBoardLink(bleId, probeId)
      })
      .then((result) => {
        if (run !== runRef.current) return
        activeProbeIdRef.current = null
        console.log('[board-link] probe result', JSON.stringify(result))
        if (result.candidates.length === 0) {
          setPhase('failed')
          return
        }
        setCandidates(result.candidates)
        setSelected(pickDefaultCandidate(result.candidates))
        setPhase('picking')
      })
      .catch((err: unknown) => {
        if (run !== runRef.current) return
        activeProbeIdRef.current = null
        console.log('[board-link] probe failed', err)
        setCandidates([])
        setSelected(null)
        setPhase('failed')
      })
  }, [bleId])

  useEffect(() => {
    const subscription = addBoardProbeProgressListener((event) => {
      if (event.probeId !== activeProbeIdRef.current) return
      console.log('[board-link] progress', JSON.stringify(event))
      // Terminal events are not stored: the terminal render comes atomically
      // from the probe promise (phase + candidates). Storing `completed` here
      // would flash an all-done timeline with placeholder captions for a frame
      // before the real result lands.
      if (event.step === 'completed' || event.step === 'failed') return
      setProgress(event)
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    runProbe()
    return () => {
      runRef.current += 1
      const probeId = activeProbeIdRef.current
      activeProbeIdRef.current = null
      if (probeId) cancelBoardProbe(probeId)
    }
  }, [runProbe])

  const select = useCallback((candidate: BoardCandidate) => setSelected(candidate), [])

  const retry = useCallback(() => {
    const probeId = activeProbeIdRef.current
    if (probeId) cancelBoardProbe(probeId)
    setPhase('linking')
    setCandidates([])
    setSelected(null)
    setProgress(null)
    runProbe()
  }, [runProbe])

  // Omit unknown identity fields entirely: the native bridge rejects maps
  // holding `undefined` values ("Cannot convert ... Value is undefined").
  const selectedLink: BoardLink | null =
    bleId != null && selected != null
      ? {
          linkVersion: 3,
          bleId,
          transport: selected.transport,
          hasBms: selected.hasBms,
          ...(selected.vescFirmwareVersion != null && {
            vescFirmwareVersion: selected.vescFirmwareVersion,
          }),
          ...(selected.refloatVersion != null && { refloatVersion: selected.refloatVersion }),
          ...(selected.refloatBaseVersion != null && {
            refloatBaseVersion: selected.refloatBaseVersion,
          }),
        }
      : null

  return { phase, candidates, selected, progress, selectedLink, select, retry }
}
