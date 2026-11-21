import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const agentsSkillsDir = resolve(root, '.agents/skills')
const claudeSkillsDir = resolve(root, '.claude/skills')

const claudeStat = lstatSync(claudeSkillsDir, { throwIfNoEntry: false })
if (claudeStat?.isSymbolicLink()) {
  const target = resolve(root, '.claude', readlinkSync(claudeSkillsDir))
  if (target === agentsSkillsDir) {
    console.log('skills-check ok (dir symlink)')
    process.exit(0)
  }
}

type Problem = {
  path: string
  message: string
}

const problems: Problem[] = []
let fixed = false

function rel(path: string) {
  return relative(root, path)
}

function readSkillNames(dir: string) {
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => lstatSync(resolve(dir, name)).isDirectory())
    .sort()
}

function expectedTarget(skillName: string) {
  return relative(claudeSkillsDir, resolve(agentsSkillsDir, skillName))
}

mkdirSync(claudeSkillsDir, { recursive: true })

const sourceSkills = new Set(readSkillNames(agentsSkillsDir))
const claudeEntries = existsSync(claudeSkillsDir)
  ? readdirSync(claudeSkillsDir).filter((name) => !name.startsWith('.'))
  : []

for (const entry of claudeEntries) {
  const entryPath = resolve(claudeSkillsDir, entry)
  const stat = lstatSync(entryPath)

  if (!stat.isSymbolicLink()) {
    if (sourceSkills.has(entry)) {
      rmSync(entryPath, { recursive: true, force: true })
      symlinkSync(expectedTarget(entry), entryPath, 'dir')
      fixed = true
    } else {
      problems.push({
        path: rel(entryPath),
        message:
          '.claude/skills must contain symlinks only; move this skill to .agents/skills or delete it',
      })
    }
    continue
  }

  if (!sourceSkills.has(entry)) {
    rmSync(entryPath)
    fixed = true
    continue
  }

  const target = readlinkSync(entryPath)
  const expected = expectedTarget(entry)

  if (target !== expected) {
    rmSync(entryPath)
    symlinkSync(expected, entryPath, 'dir')
    fixed = true
  }
}

for (const skillName of sourceSkills) {
  const linkPath = resolve(claudeSkillsDir, skillName)

  if (existsSync(linkPath)) {
    continue
  }

  symlinkSync(expectedTarget(skillName), linkPath, 'dir')
  fixed = true
}

if (problems.length > 0) {
  console.error('skills-check failed:')
  for (const problem of problems) {
    console.error(`- ${problem.path}: ${problem.message}`)
  }
  process.exit(1)
}

console.log(fixed ? 'skills-check fixed symlinks' : 'skills-check ok')
