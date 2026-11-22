import type { AppStatus } from 'vescape-core'

export interface AvailableUpdate {
  latestVersion: string
}

const MARKETING_VERSION = /^(\d+)\.(\d+)\.(\d+)$/

function parseMarketingVersion(version: string): [number, number, number] | null {
  const match = MARKETING_VERSION.exec(version)
  if (!match) return null

  const parts = match.slice(1).map(Number)
  if (parts.some((part) => !Number.isSafeInteger(part))) return null
  return parts as [number, number, number]
}

export function selectAvailableUpdate(status: AppStatus | null): AvailableUpdate | null {
  if (!status) return null

  const installed = parseMarketingVersion(status.version.installed)
  const latest = parseMarketingVersion(status.version.latest)
  if (!installed || !latest) return null

  for (let index = 0; index < installed.length; index += 1) {
    if (installed[index] < latest[index]) {
      return { latestVersion: status.version.latest }
    }
    if (installed[index] > latest[index]) return null
  }

  return null
}
