import { StyleSheet } from 'react-native'

import { theme } from '@/constants/theme'

/** Chrome shared by the map sheets: the icon badge, the title block and their pressed states. */
export const mapSheetStyles = StyleSheet.create({
  mapAddRowPressed: {
    opacity: 0.55,
  },
  mapTargetClosePressed: {
    opacity: 0.55,
  },
  mapTargetIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.neutral.surfaceDeep,
  },
  mapTargetNavigatePressed: {
    opacity: 0.55,
  },
  mapTargetNavigateText: {
    color: theme.palette.green.text,
    fontSize: 13,
    fontWeight: '900',
  },
  mapTargetSubtitle: {
    marginTop: 2,
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  mapTargetTitle: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  mapTargetTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
})
