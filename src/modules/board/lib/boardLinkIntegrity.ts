import type { LinkIntegrity } from 'vescape-core'

export interface LinkIntegrityWarning {
  text: string
  buttonText: string
  severity: 'warning' | 'error'
}

export function canRunFirmwareCommand(linkIntegrity: LinkIntegrity): boolean {
  return linkIntegrity === 'trusted'
}

export function getConnectedLinkIntegrityWarning(
  status: string,
  linkIntegrity: LinkIntegrity,
): LinkIntegrityWarning | null {
  if (status !== 'connected') return null
  if (linkIntegrity === 'outdated') {
    return {
      text: 'Board link needs update',
      buttonText: 'Re-link',
      severity: 'warning',
    }
  }
  if (linkIntegrity === 'mismatched') {
    return {
      text: 'Board hardware or firmware changed',
      buttonText: 'Re-link',
      severity: 'error',
    }
  }
  return null
}

export function firmwareCommandBlockedMessage(linkIntegrity: LinkIntegrity): string {
  if (linkIntegrity === 'checking') return 'Checking trusted board link.'
  if (linkIntegrity === 'outdated') return 'Re-link board before firmware commands.'
  if (linkIntegrity === 'mismatched') return 'Connected board does not match saved link.'
  return 'Trusted board link required.'
}
