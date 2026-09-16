import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { copyShared } from './copy-shared.ts'
import {
  missingSharedOutputs,
  planSync,
  podsFingerprint,
  prebuildFingerprint,
  sharedFingerprint,
} from './native-sync.ts'
import type { NativeState, Platform } from './native-sync.ts'

let root: string

function write(relativePath: string, contents: string) {
  const path = join(root, relativePath)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'native-sync-'))
  write('app.config.ts', 'export default {}')
  write('package.json', '{}')
  write('assets/images/icon.png', 'icon')
  write('shared/alerts/alert_beep.wav', 'beep')
  write('shared/data/cell-presets.json', '{}')
  write('modules/vescape-core/expo-module.config.json', '{}')
  write('modules/vescape-core/ios/VescapeCore.podspec', 'spec')
  write('modules/vescape-core/ios/VescapeCoreModule.swift', 'class VescapeCoreModule {}')
})

afterEach(() => {
  rmSync(root, { force: true, recursive: true })
})

describe('podsFingerprint', () => {
  it('ignores edits to existing Swift files', () => {
    const before = podsFingerprint(root)
    write(
      'modules/vescape-core/ios/VescapeCoreModule.swift',
      'class VescapeCoreModule { func added() {} }',
    )

    expect(podsFingerprint(root)).toEqual(before)
  })

  it('changes when a Swift file is added, because Pods compile a globbed file list', () => {
    const before = podsFingerprint(root)
    write('modules/vescape-core/ios/BoardPhase.swift', 'enum BoardPhase {}')

    expect(podsFingerprint(root)).not.toEqual(before)
  })

  it('changes when the podspec changes', () => {
    const before = podsFingerprint(root)
    write('modules/vescape-core/ios/VescapeCore.podspec', 'spec with new dependency')

    expect(podsFingerprint(root)).not.toEqual(before)
  })
})

describe('prebuildFingerprint', () => {
  it('regenerates Android when entering and leaving smoke mode', () => {
    const original = process.env.EXPO_PUBLIC_SMOKE
    try {
      delete process.env.EXPO_PUBLIC_SMOKE
      const normal = prebuildFingerprint('android', root)
      const ios = prebuildFingerprint('ios', root)
      process.env.EXPO_PUBLIC_SMOKE = '1'
      expect(prebuildFingerprint('android', root)).not.toEqual(normal)
      expect(prebuildFingerprint('ios', root)).toEqual(ios)
      delete process.env.EXPO_PUBLIC_SMOKE
      expect(prebuildFingerprint('android', root)).toEqual(normal)
    } finally {
      if (original === undefined) delete process.env.EXPO_PUBLIC_SMOKE
      else process.env.EXPO_PUBLIC_SMOKE = original
    }
  })

  it('changes when a config plugin is added', () => {
    const before = prebuildFingerprint('android', root)
    write('plugins/withThing.ts', 'export default {}')

    expect(prebuildFingerprint('android', root)).not.toEqual(before)
  })

  it('changes when Expo module native registration changes', () => {
    const before = prebuildFingerprint('ios', root)
    write('modules/vescape-core/expo-module.config.json', '{"platforms":["ios"]}')

    expect(prebuildFingerprint('ios', root)).not.toEqual(before)
  })

  it('tracks apple-targets sources on iOS only', () => {
    const androidBefore = prebuildFingerprint('android', root)
    const iosBefore = prebuildFingerprint('ios', root)
    write('targets/ride-activity/expo-target.config.js', 'module.exports = {}')

    expect(prebuildFingerprint('android', root)).toEqual(androidBefore)
    expect(prebuildFingerprint('ios', root)).not.toEqual(iosBefore)
  })

  it('ignores Swift edits, which prebuild does not regenerate', () => {
    const before = prebuildFingerprint('ios', root)
    write('modules/vescape-core/ios/BoardPhase.swift', 'enum BoardPhase {}')

    expect(prebuildFingerprint('ios', root)).toEqual(before)
  })

  it('changes when the launcher icon changes, which prebuild bakes into the native projects', () => {
    const before = prebuildFingerprint('android', root)
    write('assets/images/icon.png', 'new icon')

    expect(prebuildFingerprint('android', root)).not.toEqual(before)
  })

  it('changes when env values prebuild bakes into the native projects change', () => {
    write('.env', 'EXPO_PUBLIC_SERVER_URL=https://vescape.app')
    const before = prebuildFingerprint('android', root)
    write('.env.local', 'EXPO_PUBLIC_SERVER_URL=http://localhost:3000')

    expect(prebuildFingerprint('android', root)).not.toEqual(before)
  })

  it('ignores art the JS bundle loads at runtime', () => {
    const before = prebuildFingerprint('android', root)
    write('assets/logo/logo.png', 'logo')
    write('assets/map-points/pin.png', 'pin')

    expect(prebuildFingerprint('android', root)).toEqual(before)
  })
})

describe('shared assets', () => {
  it('reports every copy as missing before copy:shared runs', () => {
    expect(missingSharedOutputs(root)).toEqual([
      'modules/vescape-core/android/src/main/res/raw/alert_beep.wav',
      'modules/vescape-core/android/src/main/assets/data/cell-presets.json',
      'modules/vescape-core/android/src/test/resources/data/cell-presets.json',
    ])
  })

  it('reports nothing missing once copy:shared has run', () => {
    copyShared(root, { quiet: true })

    expect(missingSharedOutputs(root)).toEqual([])
  })

  it('reports a deleted copy as missing', () => {
    copyShared(root, { quiet: true })
    unlinkSync(join(root, 'modules/vescape-core/android/src/main/res/raw/alert_beep.wav'))

    expect(missingSharedOutputs(root)).toEqual([
      'modules/vescape-core/android/src/main/res/raw/alert_beep.wav',
    ])
  })

  it('copies sources whose extension is upper-case, since the copy is lower-cased anyway', () => {
    write('shared/alerts/Alert_Loud.WAV', 'loud')

    expect(missingSharedOutputs(root)).toContain(
      'modules/vescape-core/android/src/main/res/raw/alert_loud.wav',
    )

    copyShared(root, { quiet: true })
    expect(missingSharedOutputs(root)).toEqual([])
  })

  it('fingerprints the shared source, not the generated copies', () => {
    const before = sharedFingerprint(root)
    copyShared(root, { quiet: true })

    expect(sharedFingerprint(root)).toEqual(before)

    write('shared/alerts/alert_beep.wav', 'louder beep')
    expect(sharedFingerprint(root)).not.toEqual(before)
  })
})

describe('planSync', () => {
  const state = (platform: Platform): NativeState => ({
    shared: sharedFingerprint(root),
    prebuild: prebuildFingerprint(platform, root),
    pods: podsFingerprint(root),
  })

  const synced = (platform: Platform) => {
    copyShared(root, { quiet: true })
    return {
      platform,
      nativeDirExists: true,
      podsDirExists: true,
      missingSharedOutputs: missingSharedOutputs(root),
      cached: state(platform),
      next: state(platform),
    }
  }

  it('does nothing when every scope matches', () => {
    expect(planSync(synced('ios'))).toEqual([])
    expect(planSync(synced('android'))).toEqual([])
  })

  it('prebuilds when the native folder is missing', () => {
    const steps = planSync({ ...synced('android'), nativeDirExists: false })

    expect(steps).toEqual([{ action: 'prebuild', reasons: ['android/ is missing'] }])
  })

  it('syncs everything when no fingerprint was ever cached', () => {
    expect(planSync({ ...synced('ios'), cached: null })).toEqual([
      { action: 'prebuild', reasons: ['no cached native fingerprint'] },
      { action: 'pods', reasons: ['prebuild regenerates the Podfile'] },
    ])

    expect(planSync({ ...synced('android'), cached: null })).toEqual([
      { action: 'shared', reasons: ['no cached shared-asset fingerprint'] },
      { action: 'prebuild', reasons: ['no cached native fingerprint'] },
    ])
  })

  it('does not list every shared file when only the shared scope has no cached fingerprint', () => {
    const base = synced('android')
    const steps = planSync({ ...base, cached: { ...base.cached, shared: {} } })

    expect(steps).toEqual([{ action: 'shared', reasons: ['no cached shared-asset fingerprint'] }])
  })

  it('names the changed prebuild inputs', () => {
    const base = synced('android')
    write('app.config.ts', 'export default { name: "vescape" }')
    write('plugins/withThing.ts', 'export default {}')

    const steps = planSync({ ...base, next: state('android') })

    expect(steps).toEqual([
      { action: 'prebuild', reasons: ['+ plugins/withThing.ts', '~ app.config.ts'] },
    ])
  })

  it('installs pods after an iOS prebuild, which regenerates the Podfile', () => {
    const base = synced('ios')
    write('app.config.ts', 'export default { name: "vescape" }')

    const steps = planSync({ ...base, next: state('ios') })

    expect(steps).toEqual([
      { action: 'prebuild', reasons: ['~ app.config.ts'] },
      { action: 'pods', reasons: ['prebuild regenerates the Podfile'] },
    ])
  })

  it('installs pods when the module Swift file list changed', () => {
    const base = synced('ios')
    write('modules/vescape-core/ios/BoardPhase.swift', 'enum BoardPhase {}')

    const steps = planSync({ ...base, next: state('ios') })

    expect(steps).toEqual([{ action: 'pods', reasons: ['~ modules/vescape-core/ios#layout'] }])
  })

  it('installs pods when Pods/ is missing', () => {
    const steps = planSync({ ...synced('ios'), podsDirExists: false })

    expect(steps).toEqual([{ action: 'pods', reasons: ['ios/Pods/ is missing'] }])
  })

  it('never installs pods for android', () => {
    const base = synced('android')
    write('modules/vescape-core/ios/BoardPhase.swift', 'enum BoardPhase {}')

    const steps = planSync({ ...base, podsDirExists: false, next: state('android') })

    expect(steps).toEqual([])
  })

  it('copies shared assets when the shared source changed', () => {
    const base = synced('android')
    write('shared/alerts/alert_beep.wav', 'louder beep')

    const steps = planSync({ ...base, next: state('android') })

    expect(steps).toEqual([{ action: 'shared', reasons: ['~ shared/alerts/alert_beep.wav'] }])
  })

  it('copies shared assets when a generated copy was deleted', () => {
    const base = synced('android')
    unlinkSync(join(root, 'modules/vescape-core/android/src/main/res/raw/alert_beep.wav'))

    const steps = planSync({ ...base, missingSharedOutputs: missingSharedOutputs(root) })

    expect(steps).toEqual([
      {
        action: 'shared',
        reasons: ['! modules/vescape-core/android/src/main/res/raw/alert_beep.wav is missing'],
      },
    ])
  })

  it('does not copy shared assets for iOS, which symlinks them', () => {
    const base = synced('ios')
    write('shared/alerts/alert_beep.wav', 'louder beep')

    const steps = planSync({
      ...base,
      missingSharedOutputs: ['modules/vescape-core/android/src/main/res/raw/alert_beep.wav'],
      next: state('ios'),
    })

    expect(steps).toEqual([])
  })

  it('copies shared assets before prebuilding', () => {
    const base = synced('android')
    write('shared/alerts/alert_beep.wav', 'louder beep')
    write('app.config.ts', 'export default { name: "vescape" }')

    const steps = planSync({ ...base, next: state('android') })

    expect(steps.map((step) => step.action)).toEqual(['shared', 'prebuild'])
  })
})
