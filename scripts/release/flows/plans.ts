import type { ProductionOperation, ReleaseManifest } from '../contracts'
import type { ProductionCandidate, ReleaseTrackConfig } from '../github'
import type { ConfirmField } from '../ui'

export interface Plan {
  repo: string
  workflowRef: string
  sourceSha: string
  marketingVersion: string
  requestId: string
}

export interface PromotionPlan {
  repo: string
  workflowRef: string
  candidate: ReleaseManifest
  requestId: string
  notesPath: string
  tracks: ReleaseTrackConfig
}

export interface ProductionPlan {
  repo: string
  workflowRef: string
  candidate: ProductionCandidate
  requestId: string
  notesPath: string
  tracks: ReleaseTrackConfig
  operation: ProductionOperation
  rolloutPercentage?: number
}

export function promotionFields(promotionPlan: PromotionPlan): ConfirmField[] {
  return [
    { label: 'Workflow', value: `${promotionPlan.workflowRef}:.github/workflows/promote-open.yml` },
    { label: 'Marketing version', value: promotionPlan.candidate.marketingVersion },
    { label: 'Source SHA', value: promotionPlan.candidate.sourceSha },
    {
      label: 'Phone code',
      value: `${promotionPlan.candidate.versionCodes.phone} · recorded ${promotionPlan.tracks.phoneInternal}: ${promotionPlan.candidate.uploads.phone}`,
    },
    {
      label: 'Wear code',
      value: `${promotionPlan.candidate.versionCodes.wear} · recorded ${promotionPlan.tracks.wearInternal}: ${promotionPlan.candidate.uploads.wear}`,
    },
    { label: 'Canonical notes', value: `${promotionPlan.notesPath} on main` },
    {
      label: 'Targets',
      value: `${promotionPlan.tracks.phoneOpen} + ${promotionPlan.tracks.wearOpen}`,
    },
  ]
}

export function productionFields(productionPlan: ProductionPlan): ConfirmField[] {
  const fields: ConfirmField[] = [
    {
      label: 'Workflow',
      value: `${productionPlan.workflowRef}:.github/workflows/promote-production.yml`,
    },
    { label: 'Operation', value: productionPlan.operation },
    { label: 'Marketing version', value: productionPlan.candidate.manifest.marketingVersion },
    { label: 'Source SHA', value: productionPlan.candidate.manifest.sourceSha },
    {
      label: 'Phone code',
      value: `${productionPlan.candidate.manifest.versionCodes.phone} · current ${productionPlan.candidate.open.phone.targetTrack}: ${productionPlan.candidate.open.phone.status} · target ${productionPlan.tracks.phoneProduction}`,
    },
    {
      label: 'Wear code',
      value: `${productionPlan.candidate.manifest.versionCodes.wear} · current ${productionPlan.candidate.open.wear.targetTrack}: ${productionPlan.candidate.open.wear.status} · target ${productionPlan.tracks.wearProduction}`,
    },
    { label: 'Canonical notes', value: `${productionPlan.notesPath} at exact source SHA` },
  ]
  if (productionPlan.operation === 'promote' || productionPlan.operation === 'advance') {
    fields.push({ label: 'Rollout percentage', value: `${productionPlan.rolloutPercentage}%` })
  }
  if (productionPlan.operation === 'promote') {
    fields.push({
      label: 'Existing prerelease',
      value: `v${productionPlan.candidate.manifest.marketingVersion}`,
    })
  }
  return fields
}
