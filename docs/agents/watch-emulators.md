# Phone And Watch Emulators

`bun run wear:up` takes the machine to a phone emulator and a Wear emulator that are paired and
mirroring. It exits 0 only once the wrist logs a received frame. Otherwise it exits 1 and the last
line names the failed step: `wear: <step> failed: <reason>`.

```bash
bun run start            # Metro, in its own terminal
bun run wear:up          # boot, pair, install, prove frames
bun run wear:ride        # wear:up, then the thor301 replay and Navigation
```

`--device <AVD>` picks the phone AVD and `WEAR_AVD=<AVD>` the watch AVD. Without them a running AVD
of each kind is used, and on a cold machine the AVD picker asks (last pick on top). Nothing
machine-specific is in the repo.

## Steps

Each step checks before it acts, so a re-run with both emulators up takes about half a minute: the
Gradle no-op, then a watch app restart for the frame check. Every command and wait is time-capped.

| Step             | Does                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boot emulators` | Boots whichever AVD is not running, both at once, and waits for `sys.boot_completed` on each (5 min cap).                                          |
| `pair`           | Restores the companion's adb forward (phone `tcp:5601`), as `wear:pair` does. Opens the companion only when the watch does not reconnect.          |
| `native sync`    | `scripts/native-sync.ts android`, which prebuilds only when a native input changed. Reads the app id from `android/wearos/build.gradle`.           |
| `phone app`      | Runs `bun run android` if the dev build is missing. Checks Metro, restores `adb reverse tcp:8081`, reloads the app only if Metro does not list it. |
| `watch app`      | Builds `:wearos:assembleDebug`, re-signs it with the phone's debug key, installs only if the watch holds a different APK (sha256).                 |
| `first frame`    | Restarts the Mirror (`am start -S`) and waits for `VescMirror: first frame received`. Restarts Play services on both and retries once.             |

The first-frame check restarts the watch app on every run, because the Mirror logs its first frame
once per process. A fresh process is the only proof that frames reach the app now.

## Failures

| Message                                                     | Fix                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pair failed: … never linked … Pair with emulator`          | First run on these AVDs. In the Wear OS companion the command opened on the phone: menu > Pair with emulator, then accept every permission it asks for. Re-run. The pairing survives restarts after that.                      |
| `pair failed: no Wear OS companion`                         | Install "Wear OS" from Play on the phone AVD (a Google Play image), then re-run.                                                                                                                                               |
| `phone app failed: Metro is not running`                    | `bun run start`, then re-run.                                                                                                                                                                                                  |
| `phone app failed: … never loaded its JS from Metro`        | The dev launcher is stuck or points elsewhere. Open the app on the phone, pick the `127.0.0.1:8081` server, re-run.                                                                                                            |
| `first frame failed: … even after restarting Play services` | The automatic fix already ran. Check the phone pushes (`adb -s <phone> logcat -s VescSession` for `Watch push issue`) and the certificates (`docs/watch-mirror.md`, Signing Must Match). Cold-boot both AVDs as a last resort. |
| `boot emulators failed: … did not finish booting`           | Open the emulator window and look; a wiped or corrupt AVD wants a cold boot from Android Studio's device manager.                                                                                                              |

Two failures are handled without a message:

- **Stuck Play services.** After either emulator restarts, WearableService on the watch can keep
  logging `/telemetry` inbound while the app never receives it. `first frame` runs
  `adb -s <serial> shell am force-stop com.google.android.gms` on both emulators and checks again.
- **adb server restart.** It drops the pairing forward and the Metro reverse. Re-running `wear:up`
  restores both; the pairing itself is kept.

## Checking the wrist

```bash
adb -s <watch> exec-out screencap -p > watch.png                  # what the wrist shows
adb -s <watch> logcat -s VescMirror                               # link, first frame, decode failures
adb -s <watch> shell dumpsys activity service WearableService | grep -E 'IsConnected|/telemetry'
adb -s <phone> logcat -s VescSession                              # phone-side presence and push issues
```

`IsConnected=true` means the Data Layer link is up. Recent `/telemetry` lines mean frames reach the
watch, and `first frame received` in `VescMirror` means they reach the app.
