import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { acquireE2eLock } from './e2eLock.ts'

test('another run is rejected until the owner releases its build/device lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-lock-'))
  const path = join(dir, 'run.lock')
  try {
    const release = acquireE2eLock(path)
    expect(() => acquireE2eLock(path)).toThrow('already running')
    release()
    const next = acquireE2eLock(path)
    next()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
