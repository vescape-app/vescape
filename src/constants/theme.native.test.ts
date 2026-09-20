import { expect, expectTypeOf, test } from 'bun:test'
import type { ColorValue } from 'react-native'
import type { PathProps } from '@shopify/react-native-skia'

import { resolveAdaptiveColor, theme } from '@/constants/theme'

test('native tokens cannot cross string-only rendering boundaries without resolution', () => {
  expectTypeOf(theme.palette.sky.color).toExtend<ColorValue>()
  expectTypeOf(theme.palette.sky.color).not.toExtend<string>()
  expectTypeOf(theme.neutral.bg).not.toExtend<PathProps['color']>()
  expectTypeOf(theme.telemetry.speed).not.toExtend<string>()
  expectTypeOf(theme.alpha(theme.palette.sky.color, 0.3)).not.toExtend<string>()
  expectTypeOf(resolveAdaptiveColor(theme.palette.sky.color, 'light')).toEqualTypeOf<string>()
  expectTypeOf(theme.alpha('#123456', 0.3)).toEqualTypeOf<string>()
})

// Isolate each platform's module cache and mocks. The regular Bun preload has no native colors,
// so importing theme there alone would exercise only its string fallback.
for (const platform of ['android', 'ios', 'web']) {
  test(`${platform}: native color resolution survives alpha, chart grouping, and scrub conversion`, () => {
    const script = `
      import { mock } from 'bun:test'
      import assert from 'node:assert/strict'
      mock.module('react-native', () => ({
        Platform: { OS: ${JSON.stringify(platform)} },
        PlatformColor: (...resource_paths) => ({ resource_paths }),
        DynamicColorIOS: (dynamic) => ({ dynamic }),
      }))
      const { theme, accentColors, resolveAdaptiveColor } = await import('./src/constants/theme.ts')
      const { groupBands } = await import('./src/components/charts/line/bandGroups.ts')
      const { toScrubTargets } = await import('./src/components/charts/line/scrubTargets.ts')
      const { resolveRampGradient } = await import('./src/components/charts/line/colorRamp.ts')
      const native = ${JSON.stringify(platform)} !== 'web'
      const cyan = theme.palette.cyan.color
      const red = theme.palette.red.color
      assert.equal(typeof cyan, native ? 'object' : 'string')
      assert.equal(typeof theme.alpha(cyan, 0.3), native ? 'object' : 'string')
      for (const appearance of ['dark', 'light']) {
        const palette = accentColors[native ? appearance : 'dark']
        assert.equal(resolveAdaptiveColor(cyan, appearance), palette.cyan.color)
        assert.equal(resolveAdaptiveColor(theme.alpha(cyan, 0.3), appearance), theme.alpha(palette.cyan.color, 0.3))
        const groups = groupBands([
          { startMs: 0, endMs: 1, color: cyan },
          { startMs: 2, endMs: 3, color: red },
          { startMs: 4, endMs: 5, color: cyan },
        ], appearance)
        assert.equal(groups.length, 2, 'distinct native colors must not collapse into one band')
        assert.deepEqual(groups[0].starts, [0, 4])
        assert.equal(groups[0].color, palette.cyan.color)
        assert.equal(groups[1].color, palette.red.color)
        const chart = {
          left: { range: { min: 0, max: 10 } },
          series: [{ paths: {}, color: cyan }],
        }
        const targets = toScrubTargets(chart, appearance)
        assert.equal(targets[0].color, palette.cyan.color)
        const gradient = resolveRampGradient({ stops: [
          { value: 0, color: targets[0].color },
          { value: 10, color: groups[1].color },
        ] }, chart.left.range, 100)
        assert.ok(gradient.colors.every(color => typeof color === 'string'))
        assert.equal(resolveAdaptiveColor('#abcdef', appearance), '#abcdef')
      }
      assert.throws(() => resolveAdaptiveColor({ resource_paths: ['unknown'] }, 'dark'), /unregistered/)
      assert.throws(() => theme.alpha({ dynamic: { dark: '#000000', light: '#ffffff' } }, 0.3), /unregistered/)
    `
    const result = Bun.spawnSync([process.execPath, '--eval', script], {
      cwd: `${import.meta.dir}/../..`,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(result.stderr.toString()).toBe('')
    expect(result.exitCode).toBe(0)
  })
}
