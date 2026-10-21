import type { MapStyleKey } from '@/modules/map/constants/mapStyles'

export interface MapStyleDocument {
  styleKey: MapStyleKey
  styleSignature: string
  styleURL?: string
  styleJSON?: string
}

interface StyleLifecycle {
  applied: MapStyleDocument
  requested: MapStyleDocument
  phase: 'loading' | 'ready' | 'detaching' | 'failed'
  generation: number
  loadCount: number
}

type Action =
  | { type: 'request'; document: MapStyleDocument }
  | { type: 'apply' }
  | { type: 'loaded' | 'failed'; generation: number }
  | { type: 'retry' }

export function initialMapStyleLifecycle(document: MapStyleDocument): StyleLifecycle {
  return { applied: document, requested: document, phase: 'loading', generation: 0, loadCount: 0 }
}

/** Mapbox completion events have no document ID. Never overlap native style requests. */
export function mapStyleLifecycle(state: StyleLifecycle, action: Action): StyleLifecycle {
  switch (action.type) {
    case 'request': {
      if (action.document.styleSignature === state.requested.styleSignature) return state
      const next = { ...state, requested: action.document }
      if (state.phase === 'loading') return next
      if (state.phase === 'failed') return mapStyleLifecycle(next, { type: 'retry' })
      return {
        ...next,
        phase:
          action.document.styleSignature === state.applied.styleSignature ? 'ready' : 'detaching',
      }
    }
    case 'apply':
      return state.phase === 'detaching'
        ? { ...state, applied: state.requested, phase: 'loading' }
        : state
    case 'loaded':
      if (action.generation !== state.generation || state.phase !== 'loading') return state
      return {
        ...state,
        loadCount: state.loadCount + 1,
        phase:
          state.applied.styleSignature === state.requested.styleSignature ? 'ready' : 'detaching',
      }
    case 'failed':
      if (action.generation !== state.generation || state.phase !== 'loading') return state
      // A failed request may still emit a late completion. Replace the native view before
      // trying another document, so that completion cannot be delivered to its successor.
      return state.requested.styleSignature !== state.applied.styleSignature
        ? mapStyleLifecycle(state, { type: 'retry' })
        : { ...state, phase: 'failed' }
    case 'retry':
      return {
        ...state,
        applied: state.requested,
        phase: 'loading',
        generation: state.generation + 1,
        loadCount: 0,
      }
  }
}
