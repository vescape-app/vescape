import { useState } from 'react'
import { useSharedValue } from 'react-native-reanimated'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ValueRow } from '@/components/dev/ShowcaseControls'
import { useResolvedAccentColors } from '@/hooks/useTheme'
import { RingsChart } from '@/modules/tune/components/RingsChart'

export function RingsChartShowcase() {
  'use no memo'
  const [values, setValues] = useState([50, 50, 50])
  const [disabled, setDisabled] = useState(false)
  const [section, setSection] = useState(0)
  const accents = useResolvedAccentColors()
  const position = useSharedValue(0)
  return (
    <ShowcaseCard
      name="RingsChart"
      controls={
        <>
          <ValueRow label="values" value={values.map((v) => (v / 10).toFixed(1)).join(' / ')} />
          <ChipRow
            label="state"
            options={['editable', 'disabled', 'unequal', 'saved']}
            selected={disabled ? 'disabled' : 'editable'}
            onSelect={(value) => {
              setDisabled(value === 'disabled')
              if (value === 'unequal') setValues([25, 70, 85])
              if (value === 'saved') setValues([50, 50, 50])
            }}
          />
          <ChipRow
            label="section"
            options={['Feel', 'Brake / Turn', 'ATR']}
            selected={['Feel', 'Brake / Turn', 'ATR'][section]}
            onSelect={(value) => {
              const next = ['Feel', 'Brake / Turn', 'ATR'].indexOf(value)
              position.set(next * 280)
              setSection(next)
            }}
          />
        </>
      }
    >
      <RingsChart
        size={280}
        values={values}
        savedValues={[50, 50, 50]}
        disabled={disabled}
        color={accents.blue.color}
        referenceColor={accents.yellow.color}
        axisColors={[accents.blue.color, accents.cyan.color, accents.teal.color]}
        position={position}
        section={section}
        pageWidth={280}
        onChange={(next) => {
          setValues(next)
          return true
        }}
      />
    </ShowcaseCard>
  )
}
