import { createMotionDisplay } from './nativeDisplay'
import { useLiveMotionSettings } from '@/modules/map/store/liveMotionSettings'
import { useNavigationDiagnosticsStore } from '@/modules/map/store/navigationDiagnosticsStore'

/** One phone surface owner; diagnostics can consume it even before the map has mounted. */
export const liveMotionDisplay = createMotionDisplay('live')
let surfaces = 0
let diagnostics = 0
let disconnect: (() => void) | null = null
let stopSettings: (() => void) | null = null
let stopEvidence: (() => void) | null = null

function updateOptions() {
  const settings = useLiveMotionSettings.getState()
  liveMotionDisplay.command({
    op: 'options',
    active: surfaces > 0,
    diagnostics: diagnostics > 0,
    trail: settings.showSmoothedTrail && surfaces > diagnostics,
    raw: settings.showRawGpsPoint && surfaces > diagnostics,
  })
}
export function acquireLiveDisplay(diagnosticConsumer = false) {
  surfaces++
  if (diagnosticConsumer) diagnostics++
  if (!disconnect) {
    disconnect = liveMotionDisplay.connect()
    stopSettings = useLiveMotionSettings.subscribe((state, previous) => {
      if (
        state.showSmoothedTrail !== previous.showSmoothedTrail ||
        state.showRawGpsPoint !== previous.showRawGpsPoint
      )
        updateOptions()
    })
    stopEvidence = liveMotionDisplay.subscribe(() => {
      const motion = liveMotionDisplay.evidence()
      if (motion) useNavigationDiagnosticsStore.setState({ motion })
    })
  }
  updateOptions()
  return () => {
    surfaces--
    if (diagnosticConsumer) diagnostics--
    updateOptions()
    if (!surfaces) {
      disconnect?.()
      stopSettings?.()
      stopEvidence?.()
      disconnect = stopSettings = stopEvidence = null
      useNavigationDiagnosticsStore.setState({ motion: null })
    }
  }
}
