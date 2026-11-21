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
  // intentional-suppression: missing device history is an expected CLI result
  await Bun.write(join(CACHE_DIR, key), `${id}\n`).catch(() => undefined)
}

export function lastFirst<T>(items: T[], id: (item: T) => string, last: string | null): T[] {
  return [...items].sort((a, b) => Number(id(b) === last) - Number(id(a) === last))
}
