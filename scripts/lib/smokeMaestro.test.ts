import { expect, test } from 'bun:test'
import { completedSmokeCommands } from './smokeMaestro.ts'

const entry = (status: string, depth = 0) => ({
  command: { runFlowCommand: {} },
  metadata: { status, depth },
})
test('shutdown recovery requires all outer flows, not nested successes or partial reports', () => {
  expect(completedSmokeCommands([entry('COMPLETED'), entry('COMPLETED')], 2)).toBe(true)
  expect(completedSmokeCommands([entry('COMPLETED')], 2)).toBe(false)
  expect(completedSmokeCommands([entry('COMPLETED'), entry('FAILED')], 2)).toBe(false)
  expect(completedSmokeCommands([entry('COMPLETED'), entry('COMPLETED', 1)], 2)).toBe(false)
  expect(completedSmokeCommands(null, 2)).toBe(false)
})

test('a completed report recovers a hung child without accepting a failed flow', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const { runSmokeMaestro } = await import('./smokeMaestro.ts')
  const root = mkdtempSync(join(tmpdir(), 'smoke-process-'))
  try {
    const flow = join(root, 'flow.yaml')
    writeFileSync(flow, 'appId: test\n---\n[{"runFlow":"boot"}]')
    const script = join(root, 'child.ts')
    writeFileSync(
      script,
      `
      import { mkdirSync, writeFileSync } from 'fs'
      const debug = process.argv[process.argv.indexOf('--debug-output') + 1]
      mkdirSync(debug, { recursive: true })
      writeFileSync(debug + '/commands.json', JSON.stringify([${JSON.stringify(entry('COMPLETED'))}]))
      setInterval(() => {}, 1000)
    `,
    )
    await runSmokeMaestro([process.execPath, script, flow], flow, 10)
    writeFileSync(script, 'process.exit(7)')
    await expect(runSmokeMaestro([process.execPath, script, flow], flow, 10)).rejects.toThrow(
      'Command failed (7)',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 10000)
