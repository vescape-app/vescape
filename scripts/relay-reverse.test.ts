import { expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

test('isolated E2E setup reverses its owned ports without touching normal Metro', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-reverse-test-'))
  try {
    const log = join(directory, 'adb.log')
    const binary = join(directory, 'adb')
    writeFileSync(
      binary,
      `#!/bin/sh
if [ "$1" = devices ]; then
  printf 'List of devices attached\\nphone\\tdevice\\nwatch\\tdevice\\n'
else
  printf '%s\\n' "$*" >> "$ADB_TEST_LOG"
fi
`,
    )
    chmodSync(binary, 0o755)
    for (const port of ['57321', '']) {
      await Bun.write(log, '')
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'relay-reverse.ts')], {
        env: {
          ...process.env,
          PATH: directory,
          ADB_TEST_LOG: log,
          E2E_METRO_PORT: port || undefined,
          EXPO_PUBLIC_SERVER_URL: 'http://127.0.0.1:57322',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      expect(await child.exited).toBe(0)
      expect((await Bun.file(log).text()).trim().split('\n')).toEqual(
        ['phone', 'watch'].flatMap((serial) =>
          [port || '8081', '57322'].map(
            (value) => `-s ${serial} reverse tcp:${value} tcp:${value}`,
          ),
        ),
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
