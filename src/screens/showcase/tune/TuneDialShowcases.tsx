import { View } from 'react-native'
import { useCallback, useState } from 'react'

import { TuneDial } from '@/modules/tune/components/TuneDial'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ValueRow } from '@/components/dev/ShowcaseControls'

const RANGE_CONFIGS = {
  tune: { min: -5, max: 5, step: 1 },
  small: { min: 0, max: 10, step: 0.5 },
  medium: { min: 0, max: 100, step: 1 },
  large: { min: -50, max: 50, step: 5 },
} as const

type RangeKey = keyof typeof RANGE_CONFIGS

export function TuneDialShowcase() {
  const [value, setValue] = useState(5.0)
  const [range, setRange] = useState<RangeKey>('small')
  const config = RANGE_CONFIGS[range]

  const handleRangeChange = useCallback((r: string) => {
    const key = r as RangeKey
    const c = RANGE_CONFIGS[key]
    setRange(key)
    setValue((prev) => Math.max(c.min, Math.min(c.max, prev)))
  }, [])

  return (
    <ShowcaseCard
      name="TuneDial"
      controls={
        <>
          <ValueRow label="value" value={value} />
          <ChipRow
            label="range"
            options={['tune', 'small', 'medium', 'large']}
            selected={range}
            onSelect={handleRangeChange}
          />
        </>
      }
    >
      <TuneDial
        value={value}
        previousValue={config.min + (config.max - config.min) * 0.3}
        min={config.min}
        max={config.max}
        step={config.step}
        onValueChange={setValue}
      />
    </ShowcaseCard>
  )
}

export function CompactTuneDialShowcase() {
  const [value, setValue] = useState(0.5)

  return (
    <ShowcaseCard name="TuneDial Compact" controls={<ValueRow label="value" value={value} />}>
      <View style={{ width: 180 }}>
        <TuneDial
          value={value}
          previousValue={0.3}
          min={0}
          max={1}
          step={0.01}
          onValueChange={setValue}
        />
      </View>
    </ShowcaseCard>
  )
}

export function AlertPercentageTuneDialShowcase() {
  const [threshold, setThreshold] = useState(80)

  return (
    <ShowcaseCard
      name="TuneDial Alert Percentage"
      controls={<ValueRow label="threshold" value={`${threshold}%`} />}
    >
      <TuneDial
        value={threshold}
        previousValue={65}
        min={0}
        max={100}
        step={1}
        unit="%"
        onValueChange={setThreshold}
      />
    </ShowcaseCard>
  )
}

export function GeigerAlertTuneDialShowcase() {
  const [threshold, setThreshold] = useState(35)
  const [thresholdMax, setThresholdMax] = useState(75)

  return (
    <ShowcaseCard
      name="TuneDial Geiger Alert"
      controls={
        <>
          <ValueRow label="threshold" value={`${threshold}%`} />
          <ValueRow label="max" value={`${thresholdMax}%`} />
        </>
      }
    >
      <TuneDial
        value={threshold}
        previousValue={25}
        min={0}
        max={100}
        step={1}
        unit="%"
        indicatorGlow="right"
        valueChangeMode="commit"
        onValueChange={setThreshold}
      />
      <TuneDial
        value={thresholdMax}
        previousValue={85}
        min={0}
        max={100}
        step={1}
        unit="%"
        indicatorGlow="left"
        valueChangeMode="commit"
        onValueChange={setThresholdMax}
      />
    </ShowcaseCard>
  )
}
