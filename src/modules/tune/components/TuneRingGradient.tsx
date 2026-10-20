import { RadialGradient, Stop } from 'react-native-svg'

export function TuneRingGradient({
  id,
  color,
  compact = false,
}: {
  id: string
  color: string
  compact?: boolean
}) {
  return (
    <RadialGradient id={id} cx="50%" cy="50%" r="50%">
      <Stop offset="0" stopColor={color} stopOpacity={0.015} />
      <Stop offset={compact ? '0.5' : '0.82'} stopColor={color} stopOpacity={0.015} />
      <Stop offset="1" stopColor={color} stopOpacity={compact ? 0.5 : 0.12} />
    </RadialGradient>
  )
}
