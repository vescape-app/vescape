/**
 * Shared bits for the map services spike scripts: token loading from the main checkout's
 * `.env.local` (worktrees do not have one), polite fetch for shared public servers.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const USER_AGENT = 'vescape-spike/0.1'

function envFileCandidates() {
  const fromEnv = process.env.SPIKE_ENV_FILE
  return [
    fromEnv,
    join(process.cwd(), '.env.local'),
    join(import.meta.dir, '../../../../../.env.local'),
  ].filter((path): path is string => Boolean(path))
}

export function readEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name]
  for (const path of envFileCandidates()) {
    if (!existsSync(path)) continue
    const line = readFileSync(path, 'utf8')
      .split('\n')
      .find((row) => row.startsWith(`${name}=`))
    if (line)
      return line
        .slice(name.length + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
  }
  return undefined
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function timedFetch(url: string, init: RequestInit = {}) {
  const started = performance.now()
  const response = await fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
  })
  const text = await response.text()
  return { status: response.status, text, ms: Math.round(performance.now() - started) }
}

/** Never let a token reach stdout. */
export function redact(text: string) {
  return text
    .replace(/access_token=[^&\s"]+/g, 'access_token=***')
    .replace(/pk\.[\w.-]+|sk\.[\w.-]+/g, '***')
}
