import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const policy = join(import.meta.dir, 'policy.ts')

// Run the Git fixture outside the app test runtime and its native-module mocks.
async function promotion(newTrailer: boolean) {
  const cwd = mkdtempSync(join(tmpdir(), 'vescape-push-policy-'))
  try {
    const result = Bun.spawn(
      [
        process.execPath,
        '--eval',
        `
          import { strict as assert } from 'node:assert';
          function git(...args) {
            const result = Bun.spawnSync(['git', ...args]);
            assert.equal(result.exitCode, 0, result.stderr.toString());
            return result.stdout.toString().trim();
          }
          git('init', '-b', 'dev');
          git('config', 'user.name', 'Test');
          git('config', 'user.email', 'test@example.com');
          git('config', 'core.hooksPath', '/dev/null');
          function commit(message) {
            git('commit', '--allow-empty', '-m', message);
            return git('rev-parse', 'HEAD');
          }
          const trailer = '\\n\\nCo-Authored-By: Test <test@example.com>';
          const main = commit('Initial');
          git('update-ref', 'refs/remotes/origin/main', main);
          const dev = commit('Published change' + trailer);
          git('update-ref', 'refs/remotes/origin/dev', dev);
          const head = commit('release: 0.95.0' + (${newTrailer} ? trailer : ''));
          const result = Bun.spawnSync(
            [process.execPath, 'run', ${JSON.stringify(policy)}, 'pre-push'],
            { stdin: Buffer.from(
              'refs/heads/dev ' + head + ' refs/heads/dev ' + dev + '\\n' +
              'refs/heads/dev ' + head + ' refs/heads/main ' + main + '\\n'
            ) }
          );
          assert.equal(result.exitCode, ${newTrailer ? 1 : 0}, result.stderr.toString());
          assert.equal(result.stderr.toString(), ${JSON.stringify(newTrailer ? 'Blocked commit: remove the Co-Authored-By trailer.\n' : '')});
        `,
      ],
      { cwd, stdout: 'inherit', stderr: 'inherit' },
    )
    expect(await result.exited).toBe(0)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

test('allows promoting published history with an old co-author trailer', () => promotion(false))
test('rejects a newly introduced co-author trailer during promotion', () => promotion(true))
