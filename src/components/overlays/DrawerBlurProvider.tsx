import { BlurTargetView } from 'expo-blur'
import { createContext, useContext, useRef, type RefObject } from 'react'
import { Platform, type View } from 'react-native'

const DrawerBlurContext = createContext<RefObject<View | null> | undefined>(undefined)

/** Share the screen target across drawers, including drawers hosted in a native Modal window. */
export function DrawerBlurProvider({ children }: { children: React.ReactNode }) {
  const target = useRef<View | null>(null)
  return (
    <DrawerBlurContext value={target}>
      <BlurTargetView ref={target} style={{ flex: 1 }}>
        {children}
      </BlurTargetView>
    </DrawerBlurContext>
  )
}

export function useDrawerBlurTarget() {
  const blurTarget = useContext(DrawerBlurContext)
  const canBlur =
    blurTarget != null &&
    (Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) >= 31))
  return { blurTarget, canBlur }
}
