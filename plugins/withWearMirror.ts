import { withDangerousMod, type ConfigPlugin } from 'expo/config-plugins'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Injects the git-tracked Wear OS Mirror (`watch/wearos/`) into the Expo-generated `android/`
 * project on every prebuild (ADR-0019). `android/` is gitignored, so the mirror's durable source
 * cannot live there — this plugin copies it in and wires the Gradle build, the same pattern as
 * `withGradleJvmArgs`. It is load-bearing: keep it in step with the watch module's package name and
 * Gradle layout.
 *
 * Steps, all idempotent:
 *  1. Copy `watch/wearos/` -> `android/wearos/` (clean copy each prebuild).
 *  2. Register the module: `include ':wearos'` in `android/settings.gradle`.
 *
 * Google Play receives `:app` and `:wearos` as separate AABs on mobile and Wear OS tracks. Do not
 * add the obsolete `wearApp` dependency: Play handles delivery for the enabled form factor.
 */
const GRADLE_MODULE = ':wearos'
const WATCH_SOURCE_DIR = path.join('watch', 'wearos')
const WATCH_FONTS = {
  'Raleway-500.ttf': 'raleway_500.ttf',
  'Raleway-600.ttf': 'raleway_600.ttf',
  'JetBrainsMono-500.ttf': 'jetbrains_mono_500.ttf',
  'JetBrainsMono-600.ttf': 'jetbrains_mono_600.ttf',
} as const

const withWearMirror: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const applicationId = cfg.android?.package
      if (!applicationId) {
        throw new Error('[withWearMirror] android.package is required')
      }

      const projectRoot = cfg.modRequest.projectRoot
      const androidRoot = cfg.modRequest.platformProjectRoot

      const source = path.join(projectRoot, WATCH_SOURCE_DIR)
      if (!existsSync(source)) {
        throw new Error(`[withWearMirror] missing watch source at ${source}`)
      }

      // 1. Copy the watch source into the generated project.
      const dest = path.join(androidRoot, 'wearos')
      rmSync(dest, { recursive: true, force: true })
      cpSync(source, dest, { recursive: true })

      // Android resource names cannot contain capitals or hyphens. Copy the shared app faces
      // under resource-safe names rather than maintaining a second set in the watch source.
      const fontDest = path.join(dest, 'src', 'main', 'res', 'font')
      mkdirSync(fontDest, { recursive: true })
      for (const [assetName, resourceName] of Object.entries(WATCH_FONTS)) {
        const fontSource = path.join(projectRoot, 'assets', 'fonts', assetName)
        if (!existsSync(fontSource)) {
          throw new Error(`[withWearMirror] missing shared font at ${fontSource}`)
        }
        cpSync(fontSource, path.join(fontDest, resourceName))
      }

      // Keep phone and Wear application IDs aligned: the Wear Data Layer only connects apps with
      // the same application ID and signing certificate. Namespace/source packages stay stable.
      const buildGradlePath = path.join(dest, 'build.gradle')
      const buildGradle = readFileSync(buildGradlePath, 'utf8')
      const applicationIdPattern = /^(\s*)applicationId\s+['"][^'"]+['"]/m
      if (!applicationIdPattern.test(buildGradle)) {
        throw new Error(`[withWearMirror] applicationId missing from ${buildGradlePath}`)
      }
      writeFileSync(
        buildGradlePath,
        buildGradle.replace(applicationIdPattern, `$1applicationId '${applicationId}'`),
      )

      // 2. Register the Gradle module.
      const settingsPath = path.join(androidRoot, 'settings.gradle')
      const settings = readFileSync(settingsPath, 'utf8')
      const includeLine = `include '${GRADLE_MODULE}'`
      if (!settings.includes(includeLine)) {
        writeFileSync(settingsPath, `${settings.trimEnd()}\n${includeLine}\n`)
      }

      return cfg
    },
  ])

export default withWearMirror
