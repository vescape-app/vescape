import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addBoardProbeProgressListener,
  cancelBoardProbe,
  finalizeBoardLink,
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
  /**
   * Draft Board Link for the current selection: non-null only once complete Refloat config has
   * been acquired for that candidate. Saving is a pure persist of this draft.
   */
  selectedLink: BoardLink | null
  isFinalizing: boolean
  select: (candidate: BoardCandidate) => void
  retry: () => void
}

/**
 * Drives a Board Probe of one BLE peripheral: ends any live Board Session, runs
 * the native probe, and tracks live progress plus the confirmed candidates and
 * the rider's pick. Persistence (saving or clearing a Board Link) is the
 * caller's responsibility — this hook only resolves a draft link.
 */
export function useBoardLink(bleId: string | null, boardId: string): UseBoardLink {
  const [phase, setPhase] = useState<BoardLinkPhase>('linking')
  const [candidates, setCandidates] = useState<BoardCandidate[]>([])
  const [selected, setSelected] = useState<BoardCandidate | null>(null)
  const [progress, setProgress] = useState<BoardProbeProgressEvent | null>(null)
  const [selectedLink, setSelectedLink] = useState<BoardLink | null>(null)
  const [completedProbeId, setCompletedProbeId] = useState<string | null>(null)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const completedProbeIdRef = useRef<string | null>(null)
  const runRef = useRef(0)
  const activeProbeIdRef = useRef<string | null>(null)

  const runProbe = useCallback(() => {
    // A missing peripheral isn't probeable; callers handle the no-device case in
    // their UI, so there's nothing to run here.
    if (!bleId) return
    const run = ++runRef.current
    completedProbeIdRef.current = null
    setCompletedProbeId(null)
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
        completedProbeIdRef.current = probeId
        setCompletedProbeId(probeId)
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
      // The completed probe still reports: session + config acquisition runs after the probe
      // window closes, and its milestones drive the last two rows.
      if (
        event.probeId !== activeProbeIdRef.current &&
        event.probeId !== completedProbeIdRef.current
      )
        return
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
      if (completedProbeIdRef.current) cancelBoardProbe(completedProbeIdRef.current)
    }
  }, [runProbe])

  const select = useCallback((candidate: BoardCandidate) => {
    setSelected(candidate)
    setSelectedLink(null)
  }, [])

  /**
   * Acquire complete Refloat config for the current pick and resolve the draft link. Runs as the
   * last step of the linking run rather than on the Save press, so the checklist the rider reviews
   * has every check settled — a Board Link is never offered before its config is proven readable.
   */
  const acquireConfig = useCallback(async (): Promise<void> => {
    if (!bleId || !selected || !completedProbeId) return
    const run = runRef.current
    setProgress({
      probeId: completedProbeId,
      step: 'session',
      elapsedMs: 0,
      transport: selected.transport,
    })
    setIsFinalizing(true)
    try {
      const link = await finalizeBoardLink(completedProbeId, boardId, bleId, selected)
      if (run !== runRef.current) return
      setSelectedLink(link)
      setProgress({
        probeId: completedProbeId,
        step: 'completed',
        elapsedMs: 0,
        transport: selected.transport,
      })
    } catch (err: unknown) {
      if (run !== runRef.current) return
      console.log('[board-link] config acquisition failed', err)
      setCandidates([])
      setSelected(null)
      setSelectedLink(null)
      setPhase('failed')
    } finally {
      if (run === runRef.current) setIsFinalizing(false)
    }
  }, [bleId, boardId, completedProbeId, selected])

  // Every settled pick acquires its own config, including after a transport switch.
  useEffect(() => {
    if (phase !== 'picking' || selectedLink || isFinalizing) return
    void acquireConfig()
  }, [acquireConfig, isFinalizing, phase, selectedLink])

  const retry = useCallback(() => {
    const probeId = activeProbeIdRef.current
    if (probeId) cancelBoardProbe(probeId)
    if (completedProbeIdRef.current) cancelBoardProbe(completedProbeIdRef.current)
    setPhase('linking')
    setCandidates([])
    setSelected(null)
    setProgress(null)
    setSelectedLink(null)
    setCompletedProbeId(null)
    setIsFinalizing(false)
    completedProbeIdRef.current = null
    runProbe()
  }, [runProbe])

  // Omit unknown identity fields entirely: the native bridge rejects maps
  // holding `undefined` values ("Cannot convert ... Value is undefined").
  return {
    phase,
    candidates,
    selected,
    progress,
    selectedLink,
    isFinalizing,
    select,
    retry,
  }
}
