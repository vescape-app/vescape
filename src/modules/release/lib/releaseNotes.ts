export interface BundledReleaseNote {
  version: string
  markdown: string
}

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/

interface ParsedVersion {
  core: readonly [number, number, number]
  prerelease: readonly string[]
}

export function parseMarketingVersion(version: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(version)
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? [],
  }
}

export function compareMarketingVersions(left: string, right: string): number {
  const a = parseMarketingVersion(left)
  const b = parseMarketingVersion(right)
  if (!a || !b)
    throw new Error(`Cannot compare invalid marketing versions "${left}" and "${right}"`)

  for (let index = 0; index < a.core.length; index += 1) {
    const difference = a.core[index] - b.core[index]
    if (difference !== 0) return difference
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const aPart = a.prerelease[index]
    const bPart = b.prerelease[index]
    if (aPart === undefined || bPart === undefined) return aPart === undefined ? -1 : 1
    if (aPart === bPart) continue
    const aNumber = /^\d+$/.test(aPart) ? Number(aPart) : null
    const bNumber = /^\d+$/.test(bPart) ? Number(bPart) : null
    if (aNumber !== null && bNumber !== null) return aNumber - bNumber
    if (aNumber !== null || bNumber !== null) return aNumber !== null ? -1 : 1
    return aPart < bPart ? -1 : 1
  }
  return 0
}

export function selectReleaseNotes(
  notes: readonly BundledReleaseNote[],
  installedVersion?: string,
): BundledReleaseNote[] {
  const validInstalledVersion = installedVersion && parseMarketingVersion(installedVersion)
  return notes
    .filter(
      (note) =>
        !validInstalledVersion || compareMarketingVersions(note.version, installedVersion) <= 0,
    )
    .sort((left, right) => compareMarketingVersions(right.version, left.version))
}
