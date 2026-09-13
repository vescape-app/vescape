function reject(message: string): never {
  console.error(message)
  process.exit(1)
}

function git(...args: string[]): string {
  const result = Bun.spawnSync(['git', ...args])
  if (result.exitCode !== 0) {
    reject(result.stderr.toString().trim() || `git ${args[0]} failed`)
  }
  return result.stdout.toString().trim()
}

function checkBranch(ref: string): void {
  const branch = ref.replace(/^refs\/heads\//, '')
  if (/^(codex|claude|agent)\//.test(branch)) {
    reject(`Blocked branch '${branch}': use a feature name without an agent prefix.`)
  }
}

function checkMessage(message: string): void {
  if (/^\s*Co-Authored-By\s*:/im.test(message)) {
    reject('Blocked commit: remove the Co-Authored-By trailer.')
  }
}

switch (Bun.argv[2]) {
  case 'commit-msg': {
    const messagePath = Bun.argv[3]
    if (!messagePath) reject('Expected a commit message file.')
    checkBranch(git('branch', '--show-current'))
    checkMessage(await Bun.file(messagePath).text())
    break
  }
  case 'pre-push': {
    const input = await Bun.stdin.text()
    for (const line of input.split('\n').filter((line) => line.trim())) {
      const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/)
      if (!localRef || !localSha || !remoteRef || !remoteSha) {
        reject('Invalid pre-push input.')
      }
      // Allow deleting existing branches, including ones with blocked names.
      if (/^0+$/.test(localSha)) continue
      checkBranch(localRef)
      checkBranch(remoteRef)
      const remoteCommitExists =
        Bun.spawnSync(['git', 'cat-file', '-e', `${remoteSha}^{commit}`]).exitCode === 0
      const range = remoteCommitExists ? [`^${remoteSha}`] : ['--not', '--remotes']
      const commits = git('rev-list', localSha, ...range)
        .split('\n')
        .filter(Boolean)
      for (const commit of commits) {
        checkMessage(git('log', '-1', '--format=%B', commit))
      }
    }
    break
  }
  default:
    reject('Expected commit-msg or pre-push.')
}

export {}
