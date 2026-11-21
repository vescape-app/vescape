export interface SelectOption<T> {
  label: string
  value: T
  hint?: string
}

const ESC = '\u001b'
const TICK_MS = 1000
const HIDE_CURSOR = `${ESC}[?25l`
const SHOW_CURSOR = `${ESC}[?25h`
const DIM = `${ESC}[2m`
const CYAN = `${ESC}[36m`
const RESET = `${ESC}[0m`

export class SelectCancelled extends Error {
  constructor() {
    super('Selection cancelled')
  }
}

function truncate(text: string, max: number): string {
  if (max <= 0) return ''
  let out = ''
  let visible = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === ESC) {
      const end = text.indexOf('m', i)
      if (end === -1) break
      out += text.slice(i, end + 1)
      i = end
      continue
    }
    if (visible >= max) return `${out}…${RESET}`
    out += text[i]
    visible += 1
  }
  return out
}

function render(
  title: string,
  options: SelectOption<unknown>[],
  active: number,
  countdown: number | null,
): string {
  const width = (process.stdout.columns || 80) - 1
  const lines = options.map((option, index) => {
    const selected = index === active
    const pointer = selected ? `${CYAN}❯${RESET}` : ' '
    const label = selected ? `${CYAN}${option.label}${RESET}` : option.label
    const hint = option.hint ? ` ${DIM}${option.hint}${RESET}` : ''
    const timer = selected && countdown !== null ? ` ${DIM}(${countdown}s)${RESET}` : ''
    return truncate(`${pointer} ${label}${hint}${timer}`, width)
  })
  return `${truncate(title, width)}\n${lines.join('\n')}\n`
}

export interface SelectOptions {
  autoPickMs?: number
}

export function select<T>(
  title: string,
  options: SelectOption<T>[],
  { autoPickMs }: SelectOptions = {},
): Promise<T> {
  if (options.length === 0) throw new Error('select() needs at least one option')
  if (!process.stdin.isTTY) {
    throw new Error(
      'No TTY available for an interactive prompt — pass the value as a flag instead.',
    )
  }

  return new Promise<T>((resolve, reject) => {
    let active = 0
    let lastLineCount = 0
    let remaining = autoPickMs ?? 0
    let ticker: ReturnType<typeof setInterval> | null = null

    const draw = () => {
      if (lastLineCount > 0) process.stdout.write(`${ESC}[${lastLineCount}A${ESC}[0J`)
      const frame = render(title, options, active, ticker ? Math.ceil(remaining / 1000) : null)
      process.stdout.write(frame)
      lastLineCount = frame.split('\n').length - 1
    }

    const stopTicker = () => {
      if (!ticker) return
      clearInterval(ticker)
      ticker = null
    }

    const cleanup = () => {
      stopTicker()
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write(SHOW_CURSOR)
    }

    const onData = (chunk: Buffer) => {
      const key = chunk.toString()
      const wasCountingDown = ticker !== null
      stopTicker()
      if (key === '\u0003' || key === ESC) {
        cleanup()
        reject(new SelectCancelled())
        return
      }
      if (key === '\r' || key === '\n') {
        cleanup()
        resolve(options[active].value)
        return
      }
      if (key === `${ESC}[A` || key === 'k') active = (active - 1 + options.length) % options.length
      else if (key === `${ESC}[B` || key === 'j') active = (active + 1) % options.length
      else if (!wasCountingDown) return
      draw()
    }

    process.stdout.write(HIDE_CURSOR)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onData)

    if (autoPickMs && autoPickMs > 0) {
      ticker = setInterval(() => {
        remaining -= TICK_MS
        if (remaining > 0) {
          draw()
          return
        }
        stopTicker()
        draw()
        cleanup()
        resolve(options[0].value)
      }, TICK_MS)
    }

    draw()
  })
}
