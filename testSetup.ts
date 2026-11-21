import { mock } from 'bun:test'

export const reactNativeStub = {
  InteractionManager: {
    runAfterInteractions: (task: () => void) => {
      task()
      return { cancel: () => {} }
    },
  },
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, _cb: unknown) => ({ remove: () => {} }),
  },
}

mock.module('react-native', () => ({ ...reactNativeStub }))

mock.module('react-native-reanimated', () => ({
  makeMutable: <T>(value: T) => ({ value }),
}))

mock.module('react-native-worklets', () => ({
  scheduleOnUI: <Args extends unknown[]>(fn: (...args: Args) => unknown, ...args: Args) =>
    fn(...args),
}))

mock.module('expo-modules-core', () => ({
  requireNativeModule: (_name: string) => ({}),
  EventEmitter: class {
    addListener(_event: string, _cb: unknown) {
      return { remove: () => {} }
    }
  },
}))
