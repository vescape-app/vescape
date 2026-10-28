const { getSentryExpoConfig } = require('@sentry/react-native/metro')

const config = getSentryExpoConfig(__dirname)

config.resolver.blockList = [/.*\.test\.[jt]sx?$/, /.*\/__tests__\/.*/]
// Expo 57's client env module loads .env files separately from the CLI. Deterministic
// runners opt out of both so their process-provided origins and mode flags stay authoritative.
if (process.env.EXPO_NO_DOTENV === '1') {
  config.resolver.blockList.push(/[/\\]\.env(?:\.[^/\\]+)?$/)
}
config.resolver.assetExts.push('wasm')

module.exports = config
