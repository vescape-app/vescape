const PLAY_MAX_VERSION_CODE = 2_100_000_000

export function androidVersionCode(version: string, releaseCode?: string): number {
  if (releaseCode !== undefined) {
    const code = Number(releaseCode)
    if (
      !/^\d+$/.test(releaseCode) ||
      !Number.isSafeInteger(code) ||
      code < 1 ||
      code > PLAY_MAX_VERSION_CODE
    ) {
      throw new Error(`Invalid Android release version code "${releaseCode}"`)
    }
    return code
  }

  const parts = version.split('.')
  const numbers = parts.map(Number)

  if (
    parts.length !== 3 ||
    !numbers.every((part) => Number.isInteger(part) && part >= 0) ||
    numbers[1] > 99 ||
    numbers[2] > 99
  ) {
    throw new Error(`Invalid version "${version}"`)
  }

  const [major, minor, patch] = numbers
  return major * 10000 + minor * 100 + patch
}
