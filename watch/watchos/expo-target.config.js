/**
 * The watchOS Mirror (ADR-0019): a native SwiftUI companion app, injected into the Expo-generated
 * `ios/` project on every prebuild by `plugins/withWatchOS.ts`. `ios/` is gitignored, so this
 * directory is the durable source — the peer of `watch/wearos/` on Android.
 *
 * Identity is derived, never written down twice. `.watchkitapp` appends to the phone's bundle id, so
 * the dev and production variants (`app.vescape.dev` / `app.vescape`) each get their own companion
 * without a second variant switch to keep in step; the plugin fills `WKCompanionAppBundleIdentifier`
 * from the same phone target.
 *
 * @type {import('@bacons/apple-targets').Config}
 */
module.exports = {
  type: 'watch',
  name: 'VescapeWatch',
  displayName: 'Vescape',
  bundleIdentifier: '.watchkitapp',
  // Series 6 is the first physical test device and its installed watchOS version is not confirmed
  // (docs/watchos.md). Series 6 runs anything from watchOS 7 to 26, so the floor sits low enough
  // that the device does not have to be updated before it can be tested on. Nothing in this slice
  // needs a newer API: WatchConnectivity is watchOS 2.
  deploymentTarget: '10.0',
  frameworks: ['WatchConnectivity'],
}
