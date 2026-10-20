import { Pressable } from 'react-native'
import { GROUPS } from './tuneRingControls'

export function TuneRingSideTargets({
  page,
  center,
  radius,
  onPage,
}: {
  page: number
  center: number
  radius: number
  onPage: (page: number) => void
}) {
  return [-1, 1].map((direction) => {
    const target = page + direction
    if (target < 0 || target >= GROUPS.length) return null
    return (
      <Pressable
        key={direction}
        accessibilityRole="button"
        accessibilityLabel={`Open ${GROUPS[target].name}`}
        onPress={() => onPage(target)}
        style={{
          position: 'absolute',
          top: center - radius * 0.6,
          height: radius * 1.2,
          width: 44,
          ...(direction < 0 ? { left: -12 } : { right: -12 }),
        }}
      />
    )
  })
}
