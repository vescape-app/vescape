/**
 * "Which device did you pick last time" for the repo's device-choosing CLIs.
 *
 * Remembered per machine rather than per checkout: which phone or watch is on the desk is a
 * property of the desk, not of the repo. A missing or unreadable file is never an error — the id it
 * names is simply gone, and the list falls back to its natural order.
 */
import { homedir } from 'os'
import { join } from 'path'

const CACHE_DIR = join(homedir(), '.cache', 'vescape')

export async function readLastDevice(key: string): Promise<string | null> {
  const text = await Bun.file(join(CACHE_DIR, key))
    .text()
    .catch(() => '')
  return text.trim() || null
}

export async function rememberDevice(key: string, id: string): Promise<void> {
  await Bun.write(join(CACHE_DIR, key), `${id}\n`).catch(() => {})
}

/** Last pick first, everything else in its original order. */
export function lastFirst<T>(items: T[], id: (item: T) => string, last: string | null): T[] {
  return [...items].sort((a, b) => Number(id(b) === last) - Number(id(a) === last))
}
