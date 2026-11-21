import type { DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'
import {
  resolveConfigRelativeBase,
  type BoardConfigBases,
} from '@/modules/alerts/lib/configRelativeFields'

/** Resolve saved relationships for presentation, without generating or writing any rules.
 * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `effectiveThresholds`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `effectiveThresholds`
 */
export function resolvedAlertRules<T extends DraftAlertRule>(
  rules: readonly T[],
  bases: BoardConfigBases,
): T[] {
  return rules.flatMap((rule) => {
    if (!rule.enabled) return []
    const relationship = rule.thresholdRule
    if (relationship?.kind !== 'config-relative') return [rule]
    const base = resolveConfigRelativeBase(relationship.fieldId, bases)
    if (base == null) return []
    return [
      {
        ...rule,
        threshold: base + relationship.thresholdOffset,
        thresholdMax:
          relationship.thresholdMaxOffset == null ? null : base + relationship.thresholdMaxOffset,
      },
    ]
  })
}
