import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync } from 'fs'
import { dirname, resolve } from 'path'

/** Builds share generated native directories and installs share the phone. Reject overlapping runs. */
export function acquireE2eLock(
  path = resolve(import.meta.dir, '../../.expo/e2e.lock'),
): () => void {
  mkdirSync(dirname(path), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx')
      writeFileSync(fd, String(process.pid))
      closeSync(fd)
      const release = () => {
        try {
          if (readFileSync(path, 'utf8') === String(process.pid)) unlinkSync(path)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      process.once('exit', release)
      return () => {
        process.off('exit', release)
        release()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const owner = Number(readFileSync(path, 'utf8'))
      // An incomplete/invalid lock is not evidence that another build can safely be started.
      if (!Number.isSafeInteger(owner) || owner <= 0)
        throw new Error(`Invalid E2E lock at ${path}. Check for an active run before removing it.`)
      try {
        process.kill(owner, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
          unlinkSync(path)
          continue
        }
        throw error
      }
      throw new Error(
        `E2E is already running (PID ${owner}). Wait for it to finish or stop it with Ctrl-C.`,
      )
    }
  }
  throw new Error('Could not acquire the E2E run lock')
}
