import { withGradleProperties, type ConfigPlugin } from 'expo/config-plugins'

const PROPERTIES: Record<string, string> = {
  'org.gradle.jvmargs': '-Xmx4096m -XX:MaxMetaspaceSize=1024m',
  'android.experimental.runLintInProcess': 'true',
}

const withGradleJvmArgs: ConfigPlugin = (config) =>
  withGradleProperties(config, (cfg) => {
    const keys = new Set(Object.keys(PROPERTIES))
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === 'property' && keys.has(item.key)),
    )
    for (const [key, value] of Object.entries(PROPERTIES)) {
      cfg.modResults.push({ type: 'property', key, value })
    }
    return cfg
  })

export default withGradleJvmArgs
