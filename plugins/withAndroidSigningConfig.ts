import { withAppBuildGradle, type ConfigPlugin } from 'expo/config-plugins'

const withAndroidSigningConfig: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (cfg) => {
    let { contents } = cfg.modResults

    if (contents.includes('VESCAPE_UPLOAD_STORE_FILE')) {
      return cfg
    }

    contents = contents.replace(
      /(signingConfigs\s*\{[\s\S]*?keyPassword\s+'android'\n\s*\})/,
      `$1
        release {
            if (project.hasProperty('VESCAPE_UPLOAD_STORE_FILE')) {
                storeFile file(VESCAPE_UPLOAD_STORE_FILE)
                storePassword VESCAPE_UPLOAD_STORE_PASSWORD
                keyAlias VESCAPE_UPLOAD_KEY_ALIAS
                keyPassword VESCAPE_UPLOAD_KEY_PASSWORD
            }
        }`,
    )

    contents = contents.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
      "$1signingConfig project.hasProperty('VESCAPE_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    )

    cfg.modResults.contents = contents
    return cfg
  })

export default withAndroidSigningConfig
