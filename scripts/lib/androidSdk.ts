export function sdkRoot(): string {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  if (!sdk) {
    console.error('\nANDROID_HOME / ANDROID_SDK_ROOT not set')
    process.exit(1)
  }
  return sdk
}
