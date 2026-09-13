import type { AccessoryCapability, AccessoryLinkPhase } from 'vescape-core'

/** Native requested state; the protocol does not report physical light output. */
export function capabilityStateCopy(
  capability: AccessoryCapability,
  phase: AccessoryLinkPhase,
): string {
  if (phase !== 'connected') return 'Disconnected · output unknown'
  if (capability.enabled === false) return 'Disabled'
  if (capability.type === 'ground_clearance') {
    if (!capability.calibration || capability.calibration.problem) return 'Calibration needed'
    if (!capability.measuring) return 'Standby · waiting to ride'
    return capability.samplingRateHz
      ? `Measuring · ${capability.samplingRateHz} Hz`
      : 'Starting measurement'
  }
  const mode = capability.lightPreview ?? capability.lightMode
  const preview = capability.lightPreview ? 'Preview · ' : ''
  switch (mode) {
    case 'riding':
      return `${preview}Riding · dim red`
    case 'braking':
      return `${preview}Braking · bright red`
    case 'hard_braking':
      return `${preview}Hard braking · blinking red`
    case 'not_riding':
      return `${preview}Parked · ${capability.brakeLight?.parked === 'glow' ? 'red glow' : 'off'}`
    case null:
    case undefined:
      return 'No telemetry · device default'
  }
}
