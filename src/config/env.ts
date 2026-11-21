export const previewMode = process.env.EXPO_PUBLIC_PREVIEW === '1'

export const captureMode = process.env.EXPO_PUBLIC_SCREENSHOTS === '1' || previewMode

export const smokeMode = process.env.EXPO_PUBLIC_SMOKE === '1'

export const fixtureSession = captureMode || smokeMode

export const showDevControls = !captureMode
