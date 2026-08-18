/**
 * Bun test preload — runs before any test file is loaded.
 * Mocks native modules that can't be evaluated in a Node.js test environment:
 * - react-native: uses Flow `import typeof` syntax bun cannot parse
 * - react-native-reanimated: imports React Native native/runtime APIs during module init
 * - expo-modules-core: calls requireNativeModule() which needs the Android runtime
 * - vescape-core: our custom Expo module, also needs Android runtime
 */

import { mock } from 'bun:test'

/**
 * Baseline `react-native` surface. A test needing more (AppState, …) must spread this rather
 * than replace it — `mock.module` is global, so a bare override strips these for every file
 * loaded after it.
 */
export const reactNativeStub = {
  // Tests run without a scheduler, so deferred work resolves immediately.
  InteractionManager: {
    runAfterInteractions: (task: () => void) => {
      task()
      return { cancel: () => {} }
    },
  },
}

mock.module('react-native', () => ({ ...reactNativeStub }))

mock.module('react-native-reanimated', () => ({
  makeMutable: <T>(value: T) => ({ value }),
}))

mock.module('react-native-worklets', () => ({
  // No UI runtime in tests — run the worklet synchronously on the JS thread.
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
