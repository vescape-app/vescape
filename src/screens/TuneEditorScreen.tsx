import { TuneScreen } from '@/modules/tune/screens/TuneScreen'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

/** Compose editor preferences with the Tune domain without adding a module dependency. */
export function TuneEditorScreen() {
  const mode = useSettingsStore((state) => state.tuneEditorMode)
  const setSetting = useSettingsStore((state) => state.set)
  const error = useSettingsStore((state) => state.writeError)
  return (
    <TuneScreen
      mode={mode}
      settingError={error}
      onModeChange={(value) => {
        // intentional-suppression: settings writeError is rendered by TuneScreen
        void setSetting('tuneEditorMode', value).catch(() => undefined)
      }}
    />
  )
}
