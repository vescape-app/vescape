import { expect, test } from 'bun:test'

for (const [payload, smoothing, prediction] of [
  ['undefined', 100, 50],
  ['{}', 100, 50],
  ['{ smoothingPercent: 150 }', 150, 50],
  ['{ smoothingPercent: NaN, predictionPercent: Infinity }', 100, 50],
  ['{ smoothingPercent: 80, predictionPercent: 0 }', 80, 0],
] as const) {
  test(`native settings ${payload} initialize complete usable slider state`, () => {
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        '--preload',
        './testSetup.ts',
        '--eval',
        `
      import { mock } from 'bun:test'
      import { strict as assert } from 'node:assert'
      const writes = []
      mock.module('vescape-core', () => ({
        getGpsDisplaySettings: () => (${payload}),
        setGpsDisplaySettings: (settings) => writes.push(settings),
      }))
      const { useGpsDisplayStore } = await import('./src/modules/map/store/gpsDisplayStore.ts')
      const initial = useGpsDisplayStore.getState()
      assert.equal(initial.smoothingPercent.toFixed(0), '${smoothing}')
      assert.equal(initial.predictionPercent.toFixed(0), '${prediction}')
      initial.setPredictionPercent(50)
      assert.deepEqual(writes, [{ smoothingPercent: ${smoothing}, predictionPercent: 50 }])
    `,
      ],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect({ code: result.exitCode, stderr: new TextDecoder().decode(result.stderr) }).toEqual({
      code: 0,
      stderr: '',
    })
  })
}
