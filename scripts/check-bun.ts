import { packageManager } from '../package.json'

const expected = packageManager.slice('bun@'.length)

if (!Bun.semver.satisfies(Bun.version, `>=${expected}`)) {
  console.error(`Bun ${expected} or newer required. Found ${Bun.version}.`)
  console.error(`Install it: curl -fsSL https://bun.com/install | bash -s "bun-v${expected}"`)
  process.exit(1)
}
