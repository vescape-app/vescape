module.exports = (config) => ({
  type: 'watch',
  name: 'VescapeWatch',
  displayName: 'Vescape',
  bundleIdentifier: '.watchkitapp',
  icon: './icon.png',
  deploymentTarget: '10.0',
  frameworks: ['WatchConnectivity', 'WatchKit', 'WidgetKit'],
  entitlements: {
    'com.apple.security.application-groups': [`group.${config.ios.bundleIdentifier}.watch`],
  },
})
