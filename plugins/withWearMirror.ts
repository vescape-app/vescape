import { withDangerousMod, type ConfigPlugin } from 'expo/config-plugins'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { copyWearSharedSources } from './wearSharedSources.ts'

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

      const dest = path.join(androidRoot, 'wearos')
      rmSync(dest, { recursive: true, force: true })
      cpSync(source, dest, { recursive: true })
      copyWearSharedSources(projectRoot, dest)

      const fontDest = path.join(dest, 'src', 'main', 'res', 'font')
      mkdirSync(fontDest, { recursive: true })
      for (const [assetName, resourceName] of Object.entries(WATCH_FONTS)) {
        const fontSource = path.join(projectRoot, 'assets', 'fonts', assetName)
        if (!existsSync(fontSource)) {
          throw new Error(`[withWearMirror] missing shared font at ${fontSource}`)
        }
        cpSync(fontSource, path.join(fontDest, resourceName))
      }

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
