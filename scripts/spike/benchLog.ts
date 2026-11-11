/**
 * Spike #658: reads benchmark results from a result JSON or a raw log with `SPIKE_RESULT` lines or
 * `SPIKE_RESULT_PART <id> i/n` chunks.
 */
import { readFileSync } from 'fs'
import { basename } from 'path'

import type { BenchResult } from '../../src/modules/map/screens/benchmark/benchmarkRecorder'

export interface Run {
  label: string
  result: BenchResult
}

/** Every complete result in a log, in order; incomplete chunk sets are skipped. */
export function parseLog(text: string): BenchResult[] {
  const results: BenchResult[] = []
  const parts = new Map<string, string[]>()
  for (const line of text.split('\n')) {
    const whole = line.match(/SPIKE_RESULT (\{.*\})\s*$/)
    if (whole) {
      results.push(JSON.parse(whole[1]!))
      continue
    }
    const part = line.match(/SPIKE_RESULT_PART (\S+) (\d+)\/(\d+) (.*)$/)
    if (!part) continue
    const [, id, i, n, chunk] = part
    const list = parts.get(id!) ?? Array.from<string>({ length: Number(n) })
    list[Number(i) - 1] = chunk!
    parts.set(id!, list)
    if (list.every((c) => c !== undefined)) {
      results.push(JSON.parse(list.join('')))
      parts.delete(id!)
    }
  }
  return results
}

export function parseInput(path: string): Run[] {
  const text = readFileSync(path, 'utf8').trim()
  if (text.startsWith('{')) return [{ label: basename(path), result: JSON.parse(text) }]
  const results = parseLog(text)
  if (results.length === 0) throw new Error(`${path}: no SPIKE_RESULT found`)
  return results.map((result, i) => ({
    label: `${basename(path)}${results.length > 1 ? `#${i + 1}` : ''}`,
    result,
  }))
}
