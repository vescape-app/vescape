/** @type {import('@bacons/apple-targets').ConfigFunction} */
module.exports = (config) => ({
  type: 'watch-widget',
  name: 'WatchBattery',
  displayName: 'Board battery',
  bundleIdentifier: '.watchkitapp.battery',
  deploymentTarget: '10.0',
  entitlements: {
    'com.apple.security.application-groups': [`group.${config.ios.bundleIdentifier}.watch`],
  },
})
