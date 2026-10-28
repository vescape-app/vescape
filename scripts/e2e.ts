import { existsSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { acquireE2eLock } from './lib/e2eLock.ts'
import { e2eDevices } from './lib/e2eDevices.ts'
import { withE2eSession } from './lib/e2eSession.ts'
import {
  readE2eArgs,
  runWorkflowPlan,
  workflowCommand,
  workflowPlan,
  WORKFLOWS,
} from './lib/e2eWorkflows.ts'
import { maestroCommand, MAESTRO_VERSION } from './lib/maestro.ts'
import { select } from './lib/select.ts'

async function ensureMaestro() {
  try {
    await maestroCommand()
  } catch (error) {
    if (!process.stdin.isTTY) throw error
    console.error(error instanceof Error ? error.message : String(error))
    const install = await select('Maestro setup', [
      { label: `Install pinned Maestro ${MAESTRO_VERSION}`, value: true },
      { label: 'Cancel', value: false },
    ])
    if (!install) throw error
    await withE2eSession((session) => session.run(['bun', 'run', 'maestro:setup']))
    await maestroCommand()
  }
}

async function main() {
  const args = readE2eArgs(Bun.argv.slice(2))
  if (args.help || args.list) {
    console.log(`bun run e2e [--suite all|smoke|phone|watch|group] [--device <phone name|serial>] [--watch <Wear AVD>] [--flow <name>]

All suites run by default. In a terminal, press Enter for all or choose one suite.
--flow selects one phone flow, or one smoke flow with --suite smoke.
--all bypasses the workflow menu. Explicit --suite also bypasses it.
Devices are selected before builds. Watch suites need paired Google Play phone/Wear emulators.
Group rides need ../vescape-server with dependencies, or GROUP_RIDE_SERVER_DIR.
`)
    for (const workflow of WORKFLOWS)
      console.log(`  ${workflow.id}: ${workflow.label}, ${workflow.hint}`)
    return
  }
  const suite =
    args.suite ??
    (process.stdin.isTTY
      ? await select('E2E workflows', [
          {
            label: 'All tests',
            value: 'all' as const,
            hint: 'smoke → phone → watch telemetry → group ride',
          },
          ...WORKFLOWS.map((workflow) => ({
            label: workflow.label,
            value: workflow.id,
            hint: workflow.hint,
          })),
        ])
      : 'all')
  const plan = workflowPlan(suite)
  if (args.flow) {
    const directory = resolve(import.meta.dir, '../e2e/flows', suite === 'smoke' ? 'smoke' : '.')
    const flows = readdirSync(directory)
      .filter((file) => file.endsWith('.yaml') && !file.startsWith('_') && file !== 'e2e.yaml')
      .map((file) => file.slice(0, -5))
    args.flow = args.flow.replace(/\.yaml$/, '')
    if (!flows.includes(args.flow))
      throw new Error(`Unknown ${suite} flow "${args.flow}". Available: ${flows.join(', ')}`)
  }
  const release = acquireE2eLock()
  try {
    // Fail on prerequisites before a long build or a partially completed all run.
    if (plan.some((item) => item !== 'watch')) await ensureMaestro()
    if (plan.includes('group')) {
      const server = resolve(
        process.env.GROUP_RIDE_SERVER_DIR ?? resolve(import.meta.dir, '../../vescape-server'),
      )
      if (!existsSync(resolve(server, 'node_modules')) || !existsSync(resolve(server, 'src')))
        throw new Error(
          `Group ride requires a vescape-server checkout with dependencies at ${server}. Set GROUP_RIDE_SERVER_DIR or choose another --suite.`,
        )
    }
    const devices = await e2eDevices(
      plan.includes('watch') || plan.includes('group'),
      args.device,
      args.watch,
    )
    console.log(
      `\nE2E · ${devices.phone.name}${devices.watch ? ` + ${devices.watch.name}` : ''}\nWorkflows: ${plan.join(' → ')}\nThe selected app's data will be reset by the suites.`,
    )
    const results: string[] = []
    try {
      await withE2eSession(async (session) => {
        if (devices.watch) session.env.WEAR_AVD = devices.watch.name
        await runWorkflowPlan(
          plan,
          async (workflow) => {
            console.log(`\n=== ${WORKFLOWS.find((item) => item.id === workflow)!.label} ===`)
            await session.run(workflowCommand(workflow, devices.phone, args.flow), 90 * 60_000)
          },
          (workflow, status) => results.push(`${workflow}: ${status}`),
        )
      })
    } finally {
      console.log(`\nE2E results\n${results.join('\n')}`)
    }
  } finally {
    release()
  }
}

if (import.meta.main)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
