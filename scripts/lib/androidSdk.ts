/**
 * Where the Android SDK lives, for every CLI in the repo that reaches into it (`emulator`,
 * `build-tools`, …). Both env vars are read because Studio sets `ANDROID_HOME` and the command-line
 * tools document `ANDROID_SDK_ROOT`; a machine usually has one of the two, not both.
 */
export function sdkRoot(): string {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  if (!sdk) {
    console.error('\nANDROID_HOME / ANDROID_SDK_ROOT not set')
    process.exit(1)
  }
  return sdk
}
