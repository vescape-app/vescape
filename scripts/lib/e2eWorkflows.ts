export const WORKFLOWS = [
  {
    id: 'smoke',
    label: 'Native smoke',
    hint: 'recording replay, alerts, sound packs, history, profile',
  },
  {
    id: 'phone',
    label: 'Phone flows',
    hint: 'fake board setup, connection, privacy zones, tune, components',
  },
  {
    id: 'watch',
    label: 'Watch telemetry',
    hint: 'phone replay → Data Layer → changing wrist readouts',
  },
  {
    id: 'group',
    label: 'Group ride',
    hint: 'real local relay → phone + watch join, update and leave',
  },
] as const
export type Workflow = (typeof WORKFLOWS)[number]['id']
export interface E2eArgs {
  suite: Workflow | 'all' | null
  device: string | null
  watch: string | null
  flow: string | null
  help: boolean
  list: boolean
}

export function readE2eArgs(argv: string[]): E2eArgs {
  const args: E2eArgs = {
    suite: null,
    device: null,
    watch: null,
    flow: null,
    help: false,
    list: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (!next || next.startsWith('-')) throw new Error(`Missing value for ${arg}`)
      return next
    }
    if (arg === '--suite' || arg === '--all') {
      if (args.suite) throw new Error('Choose one --suite or --all')
      const suite = arg === '--all' ? 'all' : value()
      if (suite !== 'all' && !WORKFLOWS.some((item) => item.id === suite))
        throw new Error(
          `Unknown suite "${suite}". Choose all, ${WORKFLOWS.map((item) => item.id).join(', ')}`,
        )
      args.suite = suite as E2eArgs['suite']
    } else if (arg === '--device') args.device = value()
    else if (arg === '--watch') args.watch = value()
    else if (arg === '--flow') args.flow = value()
    else if (arg.startsWith('--flow=')) {
      args.flow = arg.slice(7)
      if (!args.flow) throw new Error('Missing value for --flow')
    } else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--list') args.list = true
    else throw new Error(`Unknown argument: ${arg}. Run bun run e2e --help`)
  }
  // Preserve the quick single-flow command; never silently apply --flow to an entire suite set.
  if (args.flow) {
    args.suite ??= 'phone'
    if (args.suite !== 'phone' && args.suite !== 'smoke')
      throw new Error('--flow requires --suite phone or --suite smoke')
  }
  return args
}

export function workflowPlan(suite: Workflow | 'all'): Workflow[] {
  return suite === 'all' ? WORKFLOWS.map((item) => item.id) : [suite]
}

export function workflowCommand(
  suite: Workflow,
  phone: { serial: string; name: string },
  flow: string | null,
): string[] {
  const script = {
    smoke: 'smoke',
    phone: 'scripts/phone-e2e.ts',
    watch: 'e2e:watch',
    group: 'e2e:group',
  }[suite]
  return [
    'bun',
    'run',
    script,
    '--device',
    suite === 'watch' || suite === 'group' ? phone.name : phone.serial,
    ...(flow ? ['--flow', flow] : []),
  ]
}

/** Shared execution seam: suites cannot overlap emulator installs, and a failure never prints all passed. */
export async function runWorkflowPlan(
  plan: Workflow[],
  run: (suite: Workflow) => Promise<void>,
  report: (suite: Workflow, status: 'passed' | 'failed' | 'not run') => void,
): Promise<void> {
  for (let i = 0; i < plan.length; i++) {
    try {
      await run(plan[i])
      report(plan[i], 'passed')
    } catch (error) {
      report(plan[i], 'failed')
      for (const remaining of plan.slice(i + 1)) report(remaining, 'not run')
      throw error
    }
  }
}
