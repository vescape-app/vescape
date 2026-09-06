import { useRef } from 'react'
import { View } from 'react-native'

import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { LEGAL_ROAD_STATUS_COLORS, type LegalLimitCountry } from '@/modules/legal/lib/legalLimits'

import { LegalLimitCountryDetails } from '@/modules/legal/components/LegalLimitCountryDetails'
import { LEGAL_LIMIT_STATUS_ICONS } from '@/modules/legal/lib/legalLimitStatusIcon'

interface LegalLimitCountrySheetProps {
  country: LegalLimitCountry | null
  onClose: () => void
}

export function LegalLimitCountrySheet({ country, onClose }: LegalLimitCountrySheetProps) {
  const triggerRef = useRef<View>(null)
  const StatusIcon = country ? LEGAL_LIMIT_STATUS_ICONS[country.status] : undefined

  return (
    <>
      <View ref={triggerRef} />
      <EdgeDrawer
        visible={country != null}
        triggerRef={triggerRef}
        edge="bottom"
        title={country?.name}
        icon={StatusIcon}
        iconColor={country ? LEGAL_ROAD_STATUS_COLORS[country.status] : undefined}
        onClose={onClose}
      >
        {country ? <LegalLimitCountryDetails country={country} /> : null}
      </EdgeDrawer>
    </>
  )
}
