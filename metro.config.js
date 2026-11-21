const { getSentryExpoConfig } = require('@sentry/react-native/metro')

const config = getSentryExpoConfig(__dirname)

config.resolver.blockList = [/.*\.test\.[jt]sx?$/, /.*\/__tests__\/.*/]
if (process.env.EXPO_NO_DOTENV === '1') {
  config.resolver.blockList.push(/[/\\]\.env(?:\.[^/\\]+)?$/)
}
config.resolver.assetExts.push('wasm')

module.exports = config
