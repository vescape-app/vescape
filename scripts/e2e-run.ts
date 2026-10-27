import { readdirSync } from 'fs'
import { basename, join } from 'path'
import { applicationId } from '../src/config/appVariant.ts'
import { maestroCommand } from './lib/maestro.ts'

const ROOT = join(import.meta.dir, '..')
const FLOWS_DIR = join(ROOT, 'e2e', 'flows')
const LEGACY_ALL_FLOW = 'e2e'

type Args = {
  all: boolean
  flow: string | null
}

function readArgs(argv: string[]): Args {
  const args: Args = { all: false, flow: null }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--all') {
      args.all = true
      continue
    }
    if (arg === '--flow') {
      const value = argv[index + 1]
      if (!value) throw new Error('Missing value for --flow')
      args.flow = value
      index += 1
      continue
    }
    if (arg.startsWith('--flow=')) {
      args.flow = arg.slice('--flow='.length)
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (args.all && args.flow) throw new Error('Use --all or --flow, not both')
  return args
}

function listFlows(): string[] {
  return readdirSync(FLOWS_DIR)
    .filter((file) => file.endsWith('.yaml'))
    .filter((file) => !file.startsWith('_'))
    .map((file) => basename(file, '.yaml'))
    .filter((flow) => flow !== LEGACY_ALL_FLOW)
    .sort()
}

function flowPath(flow: string): string {
  return join(FLOWS_DIR, `${flow}.yaml`)
}

async function runFlow(flow: string): Promise<void> {
  const proc = Bun.spawn(
    await maestroCommand(
      'test',
      '-e',
      `APP_ID=${applicationId}`,
      '-e',
      `E2E_FLOW=${flow}`,
      '-e',
      `METRO_PORT=${process.env.E2E_METRO_PORT ?? '8081'}`,
      flowPath(flow),
    ),
    {
      cwd: ROOT,
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
    },
  )
  const code = await proc.exited
  if (code !== 0) process.exit(code)
}

async function runAll(flows: string[]): Promise<void> {
  for (const flow of flows) {
    await runFlow(flow)
  }
}

let args: Args
try {
  args = readArgs(Bun.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const flows = listFlows()
const flow = args.flow ?? 'all'

if (flow === 'all') {
  await runAll(flows)
} else if (!flows.includes(flow)) {
  console.error(`Unknown flow "${flow}". Available: ${flows.join(', ')}`)
  process.exit(1)
} else {
  await runFlow(flow)
}
