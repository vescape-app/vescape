import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const logoDir = join(root, 'assets/logo')
const out = join(root, 'assets/images')

const DARK = '#111827'

const signet = readFileSync(join(logoDir, 'vescape-sygnet.svg'), 'utf8')
const text = readFileSync(join(logoDir, 'Vescape-text.svg'), 'utf8')

const signetMono = signet
  .replace(/fill="url\(#[^)]*\)"/, 'fill="#FFFFFF"')
  .replace(/<defs>[\s\S]*?<\/defs>/, '')

const svg = (s: string) => Buffer.from(s)

const render = (src: string, size: number) =>
  sharp(svg(src)).resize(size, size, { fit: 'contain', background: '#00000000' }).png()

async function main() {
  const iconInner = 820
  const iconPad = (1024 - iconInner) / 2
  await render(signet, iconInner)
    .extend({
      top: iconPad,
      bottom: iconPad,
      left: iconPad,
      right: iconPad,
      background: '#00000000',
    })
    .flatten({ background: DARK })
    .toFile(join(out, 'icon.png'))

  const fgInner = 280
  const fgPad = (512 - fgInner) / 2
  await render(signet, fgInner)
    .extend({ top: fgPad, bottom: fgPad, left: fgPad, right: fgPad, background: '#00000000' })
    .toFile(join(out, 'androidIconForeground.png'))
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: DARK },
  })
    .png()
    .toFile(join(out, 'androidIconBackground.png'))
  const monoInner = 220
  const monoPad = (432 - monoInner) / 2
  await render(signetMono, monoInner)
    .extend({
      top: monoPad,
      bottom: monoPad,
      left: monoPad,
      right: monoPad,
      background: '#00000000',
    })
    .toFile(join(out, 'androidIconMonochrome.png'))

  await render(signet, 48).toFile(join(out, 'favicon.png'))

  await sharp(svg(text))
    .resize({ width: 1200, fit: 'contain', background: '#00000000' })
    .png()
    .toFile(join(out, 'splashIcon.png'))

  console.log('Logo assets regenerated.')
}

void main()
