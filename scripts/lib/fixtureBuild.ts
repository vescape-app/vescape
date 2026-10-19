import { existsSync, mkdirSync, readdirSync } from 'fs'
import { basename, join } from 'path'

import { fixtureBuildEnv, ROOT, runOrDie, type FixtureRunMode } from './captureDriver.ts'

/** Build without booting a device so compilation never competes with an emulator in CI. */
export async function buildAndroidFixture(
  mode: FixtureRunMode,
  replay: string,
  architecture?: string,
): Promise<string> {
  const env = fixtureBuildEnv(mode, replay)
  if (architecture) env.ORG_GRADLE_PROJECT_reactNativeArchitectures = architecture
  console.log(`› Building the Android ${mode} Release app…`)
  await runOrDie(['bun', 'run', 'native:sync', 'android'], env)
  await runOrDie(
    [
      'android/gradlew',
      '-p',
      'android',
      ':app:assembleRelease',
      '-x',
      'lint',
      '-x',
      'test',
      '--build-cache',
    ],
    env,
  )
  const app = join(ROOT, 'android/app/build/outputs/apk/release/app-release.apk')
  if (!existsSync(app)) throw new Error(`Gradle succeeded but ${app} is missing.`)
  return app
}

export async function buildIosFixture(mode: FixtureRunMode, replay: string): Promise<string> {
  const env = fixtureBuildEnv(mode, replay)
  console.log(`› Building the iOS ${mode} Release app…`)
  await runOrDie(['bun', 'run', 'native:sync', 'ios'], env)
  const iosDir = join(ROOT, 'ios')
  const workspace = readdirSync(iosDir).find((entry) => entry.endsWith('.xcworkspace'))
  if (!workspace) throw new Error('native:sync ios did not generate an Xcode workspace.')
  const scheme = basename(workspace, '.xcworkspace')
  const derivedData = join(ROOT, '.expo', 'capture-ios-build')
  mkdirSync(derivedData, { recursive: true })
  const entitlements = join(derivedData, 'simulator-keychain.entitlements')
  // Ad-hoc simulator signing still needs an application identifier and keychain access group.
  await Bun.write(
    entitlements,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>application-identifier</key><string>SIMULATOR.$(PRODUCT_BUNDLE_IDENTIFIER)</string>
<key>keychain-access-groups</key><array><string>SIMULATOR.$(PRODUCT_BUNDLE_IDENTIFIER)</string></array>
</dict></plist>`,
  )
  await runOrDie(
    [
      'xcodebuild',
      '-workspace',
      join(iosDir, workspace),
      '-scheme',
      scheme,
      '-configuration',
      'Release',
      '-destination',
      'generic/platform=iOS Simulator',
      '-derivedDataPath',
      derivedData,
      `ARCHS=${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`,
      'ONLY_ACTIVE_ARCH=YES',
      'COMPILER_INDEX_STORE_ENABLE=NO',
      'CODE_SIGNING_ALLOWED=YES',
      'CODE_SIGN_IDENTITY=-',
      'CODE_SIGN_STYLE=Manual',
      'DEVELOPMENT_TEAM=',
      `CODE_SIGN_ENTITLEMENTS=${entitlements}`,
      '-showBuildTimingSummary',
      '-quiet',
      'build',
    ],
    env,
  )
  const app = join(derivedData, 'Build', 'Products', 'Release-iphonesimulator', `${scheme}.app`)
  if (!existsSync(app)) throw new Error(`xcodebuild succeeded but ${app} is missing.`)
  return app
}
