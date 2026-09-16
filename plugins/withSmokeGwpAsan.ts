import { AndroidConfig, withAndroidManifest, type ConfigPlugin } from 'expo/config-plugins'

// Temporary emulator workaround: CI crashes in Android 14's GWP-ASan unwinder while
// deallocating from Hermes. Keep production diagnostics enabled. Remove once the runtime issue is resolved.
const withSmokeGwpAsan: ConfigPlugin = (config) =>
  withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults)
    if (process.env.EXPO_PUBLIC_SMOKE === '1') app.$['android:gwpAsanMode'] = 'never'
    else delete app.$['android:gwpAsanMode']
    return cfg
  })

export default withSmokeGwpAsan
