/**
 * Normalise an SVG path `d` attribute down to the four commands a SwiftUI `Path` speaks natively:
 * absolute `M`, `L`, `C` and `Z`.
 *
 * Android takes Phosphor's `d` verbatim — VectorDrawable understands the whole grammar. watchOS
 * does not: SwiftUI has `move`/`addLine`/`addCurve`/`closeSubpath` and nothing else, so either the
 * watch carries a full SVG parser at runtime or the grammar gets flattened here, once, at build
 * time. Flattening here keeps the arc trigonometry in a language with tests and leaves the watch a
 * scanner over four letters.
 */

/** A number token, permissive about the exponent and implicit-sign forms Phosphor emits. */
const NUMBER = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g

/** How many arguments each command takes, per repetition. */
const ARITY: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
}

interface Command {
  code: string
  args: number[]
}

/**
 * Split `d` into commands, expanding the shorthand where a command letter is followed by more
 * arguments than it takes — `M` repeated becomes `L`, everything else repeats itself.
 */
function tokenize(d: string, name: string): Command[] {
  const commands: Command[] = []
  for (const match of d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)) {
    const code = match[1] as string
    const arity = ARITY[code.toLowerCase()] as number
    const args = (match[2]?.match(NUMBER) ?? []).map(Number)
    if (arity === 0) {
      if (args.length > 0) throw new Error(`${name}: ${code} takes no arguments`)
      commands.push({ code, args: [] })
      continue
    }
    if (args.length === 0 || args.length % arity !== 0) {
      throw new Error(`${name}: ${code} got ${args.length} arguments, not a multiple of ${arity}`)
    }
    for (let i = 0; i < args.length; i += arity) {
      // A repeated moveto is a lineto after the first pair, per the SVG grammar.
      const repeated = i > 0 && (code === 'M' || code === 'm')
      commands.push({
        code: repeated ? (code === 'M' ? 'L' : 'l') : code,
        args: args.slice(i, i + arity),
      })
    }
  }
  if (commands.length === 0) throw new Error(`${name}: no path commands`)
  return commands
}

interface Point {
  x: number
  y: number
}

/**
 * An elliptical arc as up to four cubic segments, one per quadrant it spans. The endpoint-to-centre
 * conversion is the one in the SVG implementation notes, including the radii correction for an
 * ellipse too small to reach the endpoint.
 */
function arcToCurves(
  from: Point,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  to: Point,
): number[][] {
  // Degenerate radii draw a straight line, and so does an arc that goes nowhere.
  if (rxIn === 0 || ryIn === 0) return [[from.x, from.y, to.x, to.y, to.x, to.y]]

  const phi = (rotationDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const dx = (from.x - to.x) / 2
  const dy = (from.y - to.y) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy

  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) {
    const scale = Math.sqrt(lambda)
    rx *= scale
    ry *= scale
  }

  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator))
  const cxp = (factor * rx * y1p) / ry
  const cyp = (-factor * ry * x1p) / rx
  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
    const sign = ux * vy - uy * vx < 0 ? -1 : 1
    return sign * Math.acos(Math.min(1, Math.max(-1, dot / len)))
  }
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let sweepAngle = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI

  const segments = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2)))
  const delta = sweepAngle / segments
  // The magic constant that makes a cubic hug a circular arc of `delta` radians.
  const alpha = (4 / 3) * Math.tan(delta / 4)

  const onEllipse = (theta: number): Point => ({
    x: cx + rx * Math.cos(theta) * cosPhi - ry * Math.sin(theta) * sinPhi,
    y: cy + rx * Math.cos(theta) * sinPhi + ry * Math.sin(theta) * cosPhi,
  })
  const derivative = (theta: number): Point => ({
    x: -rx * Math.sin(theta) * cosPhi - ry * Math.cos(theta) * sinPhi,
    y: -rx * Math.sin(theta) * sinPhi + ry * Math.cos(theta) * cosPhi,
  })

  const curves: number[][] = []
  for (let i = 0; i < segments; i += 1) {
    const start = theta1 + i * delta
    const end = start + delta
    const p0 = onEllipse(start)
    const p3 = onEllipse(end)
    const d0 = derivative(start)
    const d3 = derivative(end)
    curves.push([
      p0.x + alpha * d0.x,
      p0.y + alpha * d0.y,
      p3.x - alpha * d3.x,
      p3.y - alpha * d3.y,
      p3.x,
      p3.y,
    ])
  }
  return curves
}

/** Trim float noise without moving a 256-unit glyph by anything the eye can find. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Rewrite `d` using only absolute `M`, `L`, `C` and `Z`. Arcs become cubics, shorthand curves get
 * their implied control point spelled out, and every coordinate is absolute.
 */
export function normalizeSvgPath(d: string, name = 'path'): string {
  let current: Point = { x: 0, y: 0 }
  let subpathStart: Point = { x: 0, y: 0 }
  // The reflected control point `S`/`T` need, or null when the previous command was not a curve.
  let lastCubicControl: Point | null = null
  let lastQuadControl: Point | null = null
  const out: string[] = []

  const emit = (code: string, coords: number[]) => {
    out.push(code + coords.map(round).join(','))
  }
  const cubic = (c1: Point, c2: Point, end: Point) => {
    emit('C', [c1.x, c1.y, c2.x, c2.y, end.x, end.y])
    current = end
    lastCubicControl = c2
    lastQuadControl = null
  }
  /** A quadratic's two control points, as the equivalent cubic's. */
  const quadAsCubic = (control: Point, end: Point) => {
    const c1 = {
      x: current.x + (2 / 3) * (control.x - current.x),
      y: current.y + (2 / 3) * (control.y - current.y),
    }
    const c2 = {
      x: end.x + (2 / 3) * (control.x - end.x),
      y: end.y + (2 / 3) * (control.y - end.y),
    }
    emit('C', [c1.x, c1.y, c2.x, c2.y, end.x, end.y])
    current = end
    lastCubicControl = null
    lastQuadControl = control
  }
  /** The previous control point mirrored through the current point, or the point itself. */
  const reflect = (last: Point | null): Point =>
    last === null ? { ...current } : { x: 2 * current.x - last.x, y: 2 * current.y - last.y }

  for (const { code, args } of tokenize(d, name)) {
    const relative = code === code.toLowerCase() && code !== 'Z'
    const ox = relative ? current.x : 0
    const oy = relative ? current.y : 0

    switch (code.toUpperCase()) {
      case 'M': {
        current = { x: (args[0] as number) + ox, y: (args[1] as number) + oy }
        subpathStart = current
        emit('M', [current.x, current.y])
        lastCubicControl = null
        lastQuadControl = null
        break
      }
      case 'L': {
        current = { x: (args[0] as number) + ox, y: (args[1] as number) + oy }
        emit('L', [current.x, current.y])
        lastCubicControl = null
        lastQuadControl = null
        break
      }
      case 'H': {
        current = { x: (args[0] as number) + ox, y: current.y }
        emit('L', [current.x, current.y])
        lastCubicControl = null
        lastQuadControl = null
        break
      }
      case 'V': {
        current = { x: current.x, y: (args[0] as number) + oy }
        emit('L', [current.x, current.y])
        lastCubicControl = null
        lastQuadControl = null
        break
      }
      case 'C': {
        cubic(
          { x: (args[0] as number) + ox, y: (args[1] as number) + oy },
          { x: (args[2] as number) + ox, y: (args[3] as number) + oy },
          { x: (args[4] as number) + ox, y: (args[5] as number) + oy },
        )
        break
      }
      case 'S': {
        cubic(
          reflect(lastCubicControl),
          { x: (args[0] as number) + ox, y: (args[1] as number) + oy },
          { x: (args[2] as number) + ox, y: (args[3] as number) + oy },
        )
        break
      }
      case 'Q': {
        quadAsCubic(
          { x: (args[0] as number) + ox, y: (args[1] as number) + oy },
          { x: (args[2] as number) + ox, y: (args[3] as number) + oy },
        )
        break
      }
      case 'T': {
        quadAsCubic(reflect(lastQuadControl), {
          x: (args[0] as number) + ox,
          y: (args[1] as number) + oy,
        })
        break
      }
      case 'A': {
        const end = { x: (args[5] as number) + ox, y: (args[6] as number) + oy }
        for (const curve of arcToCurves(
          current,
          args[0] as number,
          args[1] as number,
          args[2] as number,
          (args[3] as number) !== 0,
          (args[4] as number) !== 0,
          end,
        )) {
          emit('C', curve)
        }
        current = end
        lastCubicControl = null
        lastQuadControl = null
        break
      }
      case 'Z': {
        out.push('Z')
        current = subpathStart
        lastCubicControl = null
        lastQuadControl = null
        break
      }
      default:
        throw new Error(`${name}: unsupported command ${code}`)
    }
  }
  return out.join('')
}
