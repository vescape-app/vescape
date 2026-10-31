import { expect, test } from 'bun:test'
import { readE2eArgs, runWorkflowPlan, workflowCommand, workflowPlan } from './e2eWorkflows.ts'

test('default plan covers every suite once and pins the same selected phone to setup and tests', () => {
  const args = readE2eArgs([])
  const plan = workflowPlan(args.suite ?? 'all')
  expect(plan).toEqual(['smoke', 'phone', 'watch', 'group'])
  for (const suite of plan) {
    const command = workflowCommand(
      suite,
      { serial: 'emulator-1234', name: 'Selected_Phone' },
      null,
    )
    expect(command.slice(-2)).toEqual([
      '--device',
      suite === 'watch' || suite === 'group' ? 'Selected_Phone' : 'emulator-1234',
    ])
  }
  expect(readE2eArgs(['--flow', 'history']).suite).toBe('phone')
  expect(readE2eArgs(['--suite', 'smoke', '--flow', '02-alerts']).suite).toBe('smoke')
  expect(() => readE2eArgs(['--all', '--flow', 'history'])).toThrow('--flow requires')
  expect(() => readE2eArgs(['--suite', 'unknown'])).toThrow('Unknown suite')
  expect(() => readE2eArgs(['--device', '--all'])).toThrow('Missing value')
})

test('suite execution is sequential and a failed suite stops later installs with an honest summary', async () => {
  const events: string[] = []
  let active = false
  await expect(
    runWorkflowPlan(
      workflowPlan('all'),
      async (suite) => {
        expect(active).toBe(false)
        active = true
        events.push(`start ${suite}`)
        await Bun.sleep(1)
        active = false
        if (suite === 'phone') throw new Error('phone assertion failed')
      },
      (suite, status) => events.push(`${suite} ${status}`),
    ),
  ).rejects.toThrow('phone assertion failed')
  expect(events).toEqual([
    'start smoke',
    'smoke passed',
    'start phone',
    'phone failed',
    'watch not run',
    'group not run',
  ])
})
