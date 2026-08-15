import { StyleSheet } from 'react-native'

import { theme } from '@/constants/theme'

export const mainMapLayerStyles = StyleSheet.create({
  pendingNavigationTarget: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.4),
  },
  pendingNavigationTargetCore: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
})
