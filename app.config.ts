import type { ExpoConfig } from 'expo/config'
import pkg from './package.json' with { type: 'json' }
import { applicationId, isDevelopmentApp } from './src/config/appVariant.ts'
import { androidVersionCode } from './src/helpers/version.ts'

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
    buildNumber: process.env.VERSION_CODE ?? '1',
    appleTeamId,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSBluetoothAlwaysUsageDescription:
        'Allow Vescape to connect to your board over Bluetooth for live telemetry, alerts, and ride recording.',
      NSLocationWhenInUseUsageDescription:
        'Allow Vescape to use your location for live maps, ride recording, and reconnect support while you ride.',
      NSMotionUsageDescription:
        'Allow Vescape to use device motion to determine your phone heading and orient the live ride map.',
      UIBackgroundModes: ['bluetooth-central', 'location', 'audio'],
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
        theme: './clerk-theme.json',
      },
    ],
    'expo-secure-store',
    [
      '@sentry/react-native/expo',
      {
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
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
          minSdkVersion: 30,
        },
        ios: {
          enableSceneSupport: true,
          deploymentTarget: '17.0',
        },
      },
    ],
    [
      '@bacons/apple-targets',
      {
        root: '.',
        match: '{targets/*,watch/watchos}',
      },
    ],
    '@rnmapbox/maps',
    'expo-sharing',
    [
      'expo-image-picker',
      {
        photosPermission: 'Allow Vescape to attach local photos and videos to selected rides.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    'expo-video',
    'expo-image',
    './plugins/withGradleJvmArgs',
    './plugins/withSmokeGwpAsan',
    './plugins/withWearMirror',
    './plugins/withSentryNativeInit',
    './plugins/withAndroidSigningConfig',
    './plugins/withServerOrigin',
    './plugins/withServiceTokens',
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
