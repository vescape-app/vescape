// History opens with one chart: nav + chart stack + metric tabs + legend + gaps.
// Its measured height may differ by a few pixels with platform font metrics.
export const INITIAL_HISTORY_PANEL_HEIGHT = 215

export function historyBottomGradientStart(panelHeight: number, screenHeight: number): number {
  if (screenHeight <= 0) return 1

  const resolvedPanelHeight = panelHeight > 0 ? panelHeight : INITIAL_HISTORY_PANEL_HEIGHT
  const panelTop = Math.max(0.2, 1 - resolvedPanelHeight / screenHeight)
  return Math.max(0.05, panelTop - 0.28)
}
