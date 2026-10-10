import type { ReleaseNotePlan } from './plan'

export function releaseNotesPrompt(plan: ReleaseNotePlan): string {
  return [
    'Draft rider-facing release notes for Vescape.',
    'Read .agents/skills/release-notes/SKILL.md and follow its editorial policy exactly.',
    `The target is ${plan.targetSha} and the marketing version is ${plan.marketingVersion}.`,
    `Inspect the real diff with: git diff ${plan.diffBase} ${plan.targetSha}`,
    `Also inspect relevant source around changed behavior and git log ${plan.diffBase}..${plan.targetSha}.`,
    'Use only ## New, ## Improved, ## Fixed, and ## Watch, in that order, omitting empty sections.',
    'Put wrist-facing changes under ## Watch instead of the phone sections, whatever their kind.',
    'Include only important rider-visible outcomes. Consolidate related changes into one bullet and lead each section with its most important change.',
    'Do not modify the working tree. Return only the complete Markdown body.',
  ].join('\n')
}
