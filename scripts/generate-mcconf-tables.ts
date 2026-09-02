/**
 * Generates the per-signature MCCONF layout tables consumed by both native platforms.
 *
 * Offsets come from VESC firmware's own serializer — see `scripts/mcconf-layout.ts` and
 * `docs/mcconf.md` for why VESC Tool's parameter XML cannot be used instead. Each supported
 * firmware branch contributes one layout keyed by its `MCCONF_SIGNATURE`; an unrecognized
 * signature decodes nothing (ADR 0036).
 *
 *   bun run scripts/generate-mcconf-tables.ts
 */

import { parseMcconfLayout } from './mcconf-layout'

const BRANCHES = ['release_6_05', 'release_6_06', 'release_7_00'] as const
const RAW = 'https://raw.githubusercontent.com/vedderb/bldc'

const KOTLIN_OUT =
  'modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/McconfLayouts.kt'
const SWIFT_OUT = 'modules/vescape-core/ios/config/McconfLayouts.swift'

type Field = { offset: number; size: number; name: string; kind: string; scale: number | null }

async function fetchText(branch: string, path: string): Promise<string> {
  const res = await fetch(`${RAW}/${branch}/${path}`)
  if (!res.ok) throw new Error(`${branch}/${path}: HTTP ${res.status}`)
  return res.text()
}

async function loadBranch(branch: string) {
  const header = await fetchText(branch, 'confgenerator.h')
  const signature = header.match(/#define\s+MCCONF_SIGNATURE\s+(\d+)/)?.[1]
  if (!signature) throw new Error(`${branch}: MCCONF_SIGNATURE not found`)

  const { rows, unparsed } = parseMcconfLayout(await fetchText(branch, 'confgenerator.c'))
  // An unparsed serializer line shifts every offset after it, so it can never be tolerated.
  if (unparsed.length > 0)
    throw new Error(`${branch}: unparsed serializer lines:\n${unparsed.join('\n')}`)

  const fields: Field[] = rows.slice(1).map((r) => {
    const scaled = r.type.match(/^f16\/([\d.]+)$/)
    const kind = scaled ? 'f16' : r.type
    return {
      offset: r.offset,
      size: r.size,
      name: r.name,
      kind,
      scale: scaled ? Number(scaled[1]) : null,
    }
  })
  const total = rows.at(-1)!.offset + rows.at(-1)!.size
  return { branch, signature, fields, total }
}

const KIND_KT: Record<string, string> = {
  u8: 'U8',
  uint16: 'U16',
  uint32: 'U32',
  int32: 'I32',
  f32auto: 'F32Auto',
  f16: 'F16',
}

function kotlin(layouts: Awaited<ReturnType<typeof loadBranch>>[]): string {
  const entries = layouts
    .map(
      (l) => `    ${l.signature}L to McconfLayout(
      signature = ${l.signature}L,
      firmware = "${l.branch}",
      totalBytes = ${l.total},
      fields = listOf(
${l.fields
  .map(
    (f) =>
      `        McconfField("${f.name}", ${f.offset}, McconfValueType.${KIND_KT[f.kind]}${f.scale === null ? '' : `, ${scaleLiteral(f.scale)}`}),`,
  )
  .join('\n')}
      ),
    ),`,
    )
    .join('\n')

  return `${headerComment('//')}
package expo.modules.vescapecore.config

/** @parity /modules/vescape-core/ios/config/McconfLayouts.swift */
internal enum class McconfValueType(val byteSize: Int) {
    U8(1),
    U16(2),
    U32(4),
    I32(4),
    F16(2),
    F32Auto(4),
}

internal data class McconfField(
    val id: String,
    val offset: Int,
    val type: McconfValueType,
    val scale: Double = 1.0,
)

internal data class McconfLayout(
    val signature: Long,
    val firmware: String,
    val totalBytes: Int,
    val fields: List<McconfField>,
)

internal object McconfLayouts {
    val bySignature: Map<Long, McconfLayout> = mapOf(
${entries}
    )
}
`
}

const KIND_SWIFT: Record<string, string> = {
  u8: 'u8',
  uint16: 'u16',
  uint32: 'u32',
  int32: 'i32',
  f32auto: 'f32Auto',
  f16: 'f16',
}

function swift(layouts: Awaited<ReturnType<typeof loadBranch>>[]): string {
  const entries = layouts
    .map(
      (l) => `    ${l.signature}: McconfLayout(
      signature: ${l.signature},
      firmware: "${l.branch}",
      totalBytes: ${l.total},
      fields: [
${l.fields
  .map(
    (f) =>
      `        McconfField("${f.name}", ${f.offset}, .${KIND_SWIFT[f.kind]}${f.scale === null ? '' : `, ${scaleLiteral(f.scale)}`}),`,
  )
  .join('\n')}
      ]
    ),`,
    )
    .join('\n')

  return `${headerComment('//')}
import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/McconfLayouts.kt
enum McconfValueType {
  case u8, u16, u32, i32, f16, f32Auto

  var byteSize: Int {
    switch self {
    case .u8: return 1
    case .u16, .f16: return 2
    case .u32, .i32, .f32Auto: return 4
    }
  }
}

struct McconfField {
  let id: String
  let offset: Int
  let type: McconfValueType
  let scale: Double

  init(_ id: String, _ offset: Int, _ type: McconfValueType, _ scale: Double = 1.0) {
    self.id = id
    self.offset = offset
    self.type = type
    self.scale = scale
  }
}

struct McconfLayout {
  let signature: UInt32
  let firmware: String
  let totalBytes: Int
  let fields: [McconfField]
}

enum McconfLayouts {
  static let bySignature: [UInt32: McconfLayout] = [
${entries}
  ]
}
`
}

/** Kotlin and Swift both want a Double literal here; `10000` alone infers Int in Kotlin. */
function scaleLiteral(scale: number): string {
  return Number.isInteger(scale) ? `${scale}.0` : `${scale}`
}

function headerComment(c: string): string {
  return `${c} Generated by scripts/generate-mcconf-tables.ts — do not edit.
${c} Source: vedderb/bldc confgenerator.c (${BRANCHES.join(', ')}). See docs/mcconf.md, ADR 0036.`
}

const layouts = await Promise.all(BRANCHES.map(loadBranch))
for (const l of layouts) {
  console.error(`${l.branch} signature=${l.signature} fields=${l.fields.length} bytes=${l.total}`)
}
await Bun.write(KOTLIN_OUT, kotlin(layouts))
await Bun.write(SWIFT_OUT, swift(layouts))
console.error(`wrote ${KOTLIN_OUT}\nwrote ${SWIFT_OUT}`)
