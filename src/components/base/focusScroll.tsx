import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import type { ScrollView, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'

interface FocusScrollContextValue {
  focusId: string | null
  scrollToTarget: (id: string, target: View) => void
}

const FocusScrollContext = createContext<FocusScrollContextValue | null>(null)

const HIGHLIGHT_DURATION_MS = 1400

export function FocusScrollProvider({
  scrollRef,
  headerHeight,
  bottomInset = 0,
  viewportHeight,
  children,
}: {
  scrollRef: RefObject<ScrollView | null>
  headerHeight: number
  bottomInset?: number
  viewportHeight: number
  children: ReactNode
}) {
  const { focus } = useLocalSearchParams<{ focus?: string | string[] }>()
  const focusId = Array.isArray(focus) ? (focus[0] ?? null) : (focus ?? null)
  const scrolledForRef = useRef<string | null>(null)

  useEffect(() => {
    if (!focusId) scrolledForRef.current = null
  }, [focusId])

  const scrollToTarget = useCallback(
    (id: string, target: View) => {
      if (!focusId || id !== focusId || scrolledForRef.current === focusId) return
      const scrollNode = scrollRef.current
      if (!scrollNode) return
      scrolledForRef.current = focusId
      requestAnimationFrame(() => {
        target.measureLayout(
          scrollNode as unknown as View,
          (_x, y, _w, height) => {
            const visibleHeight = Math.max(0, viewportHeight - headerHeight - bottomInset)
            const centeredY = y - headerHeight - (visibleHeight - height) / 2
            const topAlignedY = y - headerHeight - 16
            scrollNode.scrollTo({
              y: Math.max(0, Math.min(centeredY, topAlignedY)),
              animated: true,
            })
          },
          () => {},
        )
      })
    },
    [bottomInset, focusId, headerHeight, scrollRef, viewportHeight],
  )

  return (
    <FocusScrollContext.Provider value={{ focusId, scrollToTarget }}>
      {children}
    </FocusScrollContext.Provider>
  )
}

export function useFocusTarget(id?: string) {
  const context = useContext(FocusScrollContext)
  const targetRef = useRef<View>(null)
  const [highlighted, setHighlighted] = useState(false)
  const matched = Boolean(id && context?.focusId && id === context.focusId)

  useEffect(() => {
    if (!matched) return
    setHighlighted(true)
    const timer = setTimeout(() => setHighlighted(false), HIGHLIGHT_DURATION_MS)
    return () => clearTimeout(timer)
  }, [matched])

  const onLayout = useCallback(() => {
    if (matched && id && targetRef.current) {
      context?.scrollToTarget(id, targetRef.current)
    }
  }, [context, id, matched])

  return { targetRef, onLayout, highlighted }
}
