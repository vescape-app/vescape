import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { MAESTRO_VERSION, maestroCommand } from './lib/maestro.ts'

const response = await fetch('https://get.maestro.mobile.dev')
if (!response.ok) throw new Error(`Maestro installer download failed: ${response.status}`)
const directory = mkdtempSync(join(tmpdir(), 'vescape-maestro-install-'))
try {
  const script = join(directory, 'install.sh')
  writeFileSync(script, await response.text())
  const proc = Bun.spawn(['bash', script], {
    env: { ...process.env, MAESTRO_VERSION },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if ((await proc.exited) !== 0) throw new Error('Maestro installation failed.')
  await maestroCommand('--version')
  console.log(`Maestro ${MAESTRO_VERSION} installed and verified.`)
} finally {
  rmSync(directory, { recursive: true, force: true })
}
