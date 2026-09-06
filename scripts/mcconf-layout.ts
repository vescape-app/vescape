/**
 * Derives the MCCONF binary layout from VESC firmware's own serializer.
 *
 * Offsets in `COMM_GET_MCCONF` blobs are cumulative, so they can only be obtained by walking
 * `confgenerator_serialize_mcconf` field by field. VESC Tool's parameter XML describes editor
 * metadata, not wire format, and disagrees with the firmware on several fields — see
 * `docs/mcconf.md`.
 *
 *   curl -sO https://raw.githubusercontent.com/vedderb/bldc/release_6_05/confgenerator.c
 *   bun run scripts/mcconf-layout.ts confgenerator.c
 */

type Row = { offset: number; type: string; size: number; name: string }

const parsers: { re: RegExp; type: (m: RegExpMatchArray) => string; size: number; name: number }[] =
  [
    {
      re: /^buffer\[ind\+\+\]\s*=\s*(?:\((?:u?int8_t)\)\s*)?conf->([\w[\].]+);/,
      type: () => 'u8',
      size: 1,
      name: 1,
    },
    {
      re: /^buffer_append_float32_auto\(buffer,\s*conf->([\w[\].]+),/,
      type: () => 'f32auto',
      size: 4,
      name: 1,
    },
    {
      re: /^buffer_append_float16\(buffer,\s*conf->([\w[\].]+),\s*([\d.]+),/,
      type: (m) => `f16/${m[2]}`,
      size: 2,
      name: 1,
    },
    {
      re: /^buffer_append_float32\(buffer,\s*conf->([\w[\].]+),\s*([\d.e]+),/,
      type: (m) => `f32/${m[2]}`,
      size: 4,
      name: 1,
    },
    {
      re: /^buffer_append_(u?int16)\(buffer,\s*(?:conf->)?([\w[\].]+),/,
      type: (m) => m[1]!,
      size: 2,
      name: 2,
    },
    {
      re: /^buffer_append_(u?int32)\(buffer,\s*(?:conf->)?([\w[\].]+),/,
      type: (m) => m[1]!,
      size: 4,
      name: 2,
    },
  ]

export function parseMcconfLayout(source: string): { rows: Row[]; unparsed: string[] } {
  const body = source.match(/int32_t confgenerator_serialize_mcconf\([\s\S]*?\n\}/)?.[0]
  if (!body) throw new Error('confgenerator_serialize_mcconf not found')

  const rows: Row[] = []
  const unparsed: string[] = []
  let offset = 0

  for (const raw of body.split('\n')) {
    const line = raw.trim()
    const hit = parsers
      .map((p) => ({ p, m: line.match(p.re) }))
      .find((x): x is { p: (typeof parsers)[number]; m: RegExpMatchArray } => x.m !== null)

    if (hit) {
      rows.push({ offset, type: hit.p.type(hit.m), size: hit.p.size, name: hit.m[hit.p.name]! })
      offset += hit.p.size
      continue
    }
    // An unparsed serializer line would shift every following offset, so it must be reported.
    if (line.includes('buffer_append') || (line.includes('buffer[') && line.includes('ind'))) {
      unparsed.push(line)
    }
  }
  return { rows, unparsed }
}

if (import.meta.main) {
  const path = process.argv[2]
  if (!path) throw new Error('usage: bun run scripts/mcconf-layout.ts <confgenerator.c>')
  const { rows, unparsed } = parseMcconfLayout(await Bun.file(path).text())
  for (const line of unparsed) console.error(`UNPARSED\t${line}`)
  for (const r of rows) console.log(`${r.offset}\t${r.type}\t${r.size}\t${r.name}`)
  console.error(`fields=${rows.length} bytes=${rows.at(-1)!.offset + rows.at(-1)!.size}`)
}
