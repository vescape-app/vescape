/**
 * Arrow-key single-select prompt for the repo's CLI harnesses.
 *
 * Deliberately dependency-free: raw-mode stdin plus a handful of ANSI codes is the whole
 * implementation, and a script that only needs to ask "which one?" should not pull in a prompt
 * library. Requires a TTY — callers running non-interactively must pass an explicit flag instead.
 */

export interface SelectOption<T> {
  label: string
  value: T
  /** Dimmed text after the label. */
  hint?: string
}

const ESC = '\u001b'
/** Countdown redraw step. One second, so the number in the row is the number that ticks. */
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

/**
 * Truncate to `max` *visible* columns, passing ANSI escapes through uncounted.
 *
 * The redraw rewinds by a fixed number of rows, so a line that soft-wraps would leave the cursor in
 * the wrong place and stack frames instead of replacing them. Clamping every line to the terminal
 * width keeps one line equal to one row.
 */
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
  // `||`, not `??`: some terminals report 0 columns, which would truncate every line to nothing.
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
  /**
   * Auto-pick the first option after this many milliseconds, counting down in its row. Callers put
   * the remembered choice first, so the common case is "hit enter, or wait". Any keypress cancels
   * the timer for good — once the list is being driven by hand, it must never move on its own.
   */
  autoPickMs?: number
}

/** Resolves to the chosen option's value. Rejects with `SelectCancelled` on Esc or Ctrl-C. */
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
      // Rewind over the previous frame so the list updates in place instead of scrolling away.
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
      // The rider took over: never auto-pick under their hands.
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
