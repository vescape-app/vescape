const PLAY_MAX_VERSION_CODE = 2_100_000_000
const PHONE_CODE_BASE = 100_000_000
const WEAR_CODE_BASE = 1_100_000_000

export interface AndroidArtifactCodes {
  phone: number
  wear: number
}

export function allocateAndroidArtifactCodes(runNumber: number): AndroidArtifactCodes {
  if (!Number.isSafeInteger(runNumber) || runNumber < 1) {
    throw new Error(`Invalid workflow run number "${runNumber}"`)
  }

  const phone = PHONE_CODE_BASE + runNumber
  const wear = WEAR_CODE_BASE + runNumber
  if (wear > PLAY_MAX_VERSION_CODE) {
    throw new Error(`Wear version code ${wear} exceeds the Play limit`)
  }

  return { phone, wear }
}
