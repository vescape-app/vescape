import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type { BrakeLightMode } from 'vescape-core'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow, ValueRow } from '@/components/dev/ShowcaseControls'
import { BrakeLightStates } from '@/modules/accessories/components/BrakeLightStates'

const MODES: BrakeLightMode[] = ['not_riding', 'riding', 'braking', 'hard_braking']

export function BrakeLightStatesShowcase() {
  const [mode, setMode] = useState<BrakeLightMode>('riding')
  const [holding, setHolding] = useState(false)
  const [glow, setGlow] = useState(false)
  const [disabled, setDisabled] = useState(false)

  return (
    <ShowcaseCard
      name="BrakeLightStates"
      controls={
        <>
          <ChipRow
            label="live state"
            options={MODES}
            selected={mode}
            onSelect={(next) => setMode(next as BrakeLightMode)}
          />
          <ToggleRow label="rider is holding it" value={holding} onToggle={setHolding} />
          <ToggleRow label="parked glows" value={glow} onToggle={setGlow} />
          <ToggleRow label="disconnected or off" value={disabled} onToggle={setDisabled} />
          <ValueRow label="hold" value={holding ? '7s left' : 'Board drives it'} />
        </>
      }
    >
      <View style={styles.stack}>
        <BrakeLightStates
          activeMode={mode}
          previewMode={holding ? mode : null}
          parked={glow ? 'glow' : 'off'}
          previewSecondsLeft={holding ? 7 : null}
          disabled={disabled}
          onPreview={(next) => {
            setHolding(next != null)
            if (next) setMode(next)
          }}
        />
      </View>
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  stack: { alignSelf: 'stretch', gap: 8 },
})
