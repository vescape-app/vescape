import type { BoardWarningSeverity } from 'vescape-core'

import { theme } from '@/constants/theme'

export function severityStatus(severity: BoardWarningSeverity) {
  return severity === 'critical' ? theme.status.error : theme.status.warning
}

export const SEVERITY_LABEL: Record<BoardWarningSeverity, string> = {
  warn: 'Warning',
  critical: 'Critical',
}
