import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const exchange = await mkdtemp(join(tmpdir(), 'vescape-backup-cross-'))

async function run(command: string[], env: Record<string, string> = {}) {
  const process = Bun.spawn(command, {
    cwd: join(import.meta.dir, '..'),
    env: { ...Bun.env, ...env },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await process.exited
  if (code !== 0) throw new Error(`${command.join(' ')} failed with exit code ${code}`)
}

try {
  await run(['bun', 'run', 'test:persistence:android'], {
    VESCAPE_BACKUP_EXCHANGE: exchange,
    VESCAPE_BACKUP_PHASE: 'export-android',
  })
  await run(['bun', 'run', 'test:persistence:ios'], { VESCAPE_BACKUP_EXCHANGE: exchange })
  await run(
    [
      './modules/vescape-core/persistence-jvm/gradlew',
      '-p',
      'modules/vescape-core/persistence-jvm',
      'test',
      '--tests',
      'expo.modules.vescapecore.telemetry.DatabaseRestoreHostTest.crossPlatformProductionArchivePipeline',
    ],
    { VESCAPE_BACKUP_EXCHANGE: exchange, VESCAPE_BACKUP_PHASE: 'import-ios' },
  )
} finally {
  await rm(exchange, { recursive: true, force: true })
}
