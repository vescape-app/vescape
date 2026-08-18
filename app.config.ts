import type { ExpoConfig } from 'expo/config'
import pkg from './package.json' with { type: 'json' }
import { applicationId, isDevelopmentApp } from './src/config/appVariant.ts'
import { androidVersionCode } from './src/helpers/version.ts'

// Without a team ID, prebuild happily writes an Xcode project with no DEVELOPMENT_TEAM and the
// failure only surfaces minutes later as "Signing for X requires a development team". Expo loads
// .env.local automatically, so the fix is a line there — say so at the point of failure.
const appleTeamId = process.env.APPLE_TEAM_ID
if (!appleTeamId) {
  console.warn(
    'APPLE_TEAM_ID is not set — the generated iOS project will not be signable. Add APPLE_TEAM_ID to .env.local before prebuilding for a device.',
  )
}

const config: ExpoConfig = {
  name: isDevelopmentApp ? 'vescape dev' : 'vescape',
  slug: 'vescape',
  version: pkg.version,
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'vescape',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: false,
    bundleIdentifier: applicationId,
    // Required by @bacons/apple-targets to sign the ride-activity widget extension. Account-specific
    // 10-char Apple Developer team ID — set APPLE_TEAM_ID at prebuild/build time (EAS secret / .env).
    appleTeamId,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSBluetoothAlwaysUsageDescription:
        'Allow Vescape to connect to your board over Bluetooth for live telemetry, alerts, and ride recording.',
      NSLocationWhenInUseUsageDescription:
        'Allow Vescape to use your location for live maps, ride recording, and reconnect support while you ride.',
      UIBackgroundModes: ['bluetooth-central', 'location', 'audio'],
      // Board Session status surface — native-driven Live Activity (peer of Android's persistent
      // foreground notification). See targets/ride-activity + plugins/withLiveActivityAttributes.
      NSSupportsLiveActivities: true,
    },
  },
  android: {
    versionCode: androidVersionCode(pkg.version, process.env.VERSION_CODE),
    adaptiveIcon: {
      backgroundColor: '#111827',
      foregroundImage: './assets/images/androidIconForeground.png',
      backgroundImage: './assets/images/androidIconBackground.png',
      monochromeImage: './assets/images/androidIconMonochrome.png',
    },
    predictiveBackGestureEnabled: false,
    package: applicationId,
    // Play's Photo and Video Permissions policy rejected READ_MEDIA_*; ride media uses the
    // permissionless system photo picker instead. READ_MEDIA_* is API 33+ and the storage pair
    // is maxSdk<=32; at minSdk 30 expo-image-picker contributes the storage pair, so blocking
    // all five is what keeps them out of the merged manifest.
    blockedPermissions: [
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-status-bar',
    [
      '@clerk/expo',
      {
        // Always-dark Vescape palette for Clerk's native auth/account views. Consumed at
        // prebuild (Android asset / iOS Info.plist) — changes need a fresh `bun run android`.
        theme: './clerk-theme.json',
      },
    ],
    'expo-secure-store',
    [
      '@sentry/react-native/expo',
      {
        // Falls back to SENTRY_ORG / SENTRY_PROJECT env vars during builds;
        // source-map upload additionally needs SENTRY_AUTH_TOKEN.
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        // `sentry.gradle` (applied by this plugin) only uploads the JS bundle and its source
        // maps. NDK debug files need the separate Sentry Android Gradle Plugin, without which
        // every native frame in a segfault stays `?` — including our own vescape-core code
        // (VESCAPE-1D). React Native's own prebuilt .so files ship stripped, so frames inside
        // RN/Hermes stay unresolved either way.
        experimental_android: {
          enableAndroidGradlePlugin: true,
        },
      },
    ],
    [
      'expo-dev-client',
      {
        toolsButton: false,
        skipOnboarding: true,
        showMenuAtLaunch: false,
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/images/splashIcon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#111827',
        dark: {
          backgroundColor: '#111827',
        },
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          // Android 11+. Do not raise back to 33: D8 strips `SDK_INT >= 33` guards against
          // minSdk, which removed AppCompat's guard around Activity.getOnBackInvokedDispatcher()
          // and crashed every API 30-32 launch (VESCAPE-38).
          minSdkVersion: 30,
        },
        ios: {
          // Clerk's native iOS SDK requires 17.0. Keep app, pods, and widget aligned.
          deploymentTarget: '17.0',
        },
      },
    ],
    '@bacons/apple-targets',
    '@rnmapbox/maps',
    'expo-sharing',
    [
      'expo-image-picker',
      {
        // System photo picker only — no camera/mic use, and no READ_MEDIA_* permissions on
        // Android (Play Photo and Video Permissions policy).
        photosPermission: 'Allow Vescape to attach local photos and videos to selected rides.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    'expo-video',
    'expo-image',
    './plugins/withGradleJvmArgs',
    './plugins/withWearMirror',
    './plugins/withSentryNativeInit',
    './plugins/withAndroidSigningConfig',
    './plugins/withServerOrigin',
    './plugins/withMapboxToken',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    eas: {
      projectId: 'f8fcff68-4094-43c3-8eb0-9c1b291270e1',
    },
  },
}

export default config
