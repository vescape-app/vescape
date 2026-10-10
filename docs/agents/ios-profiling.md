# On-Device iOS Profiling

Headless Instruments against a real iPhone. No Xcode UI. Every step below has a failure mode that
looks like something else, so follow the order.

## 1. Get the device

```bash
xcrun devicectl list devices          # -> identifier (CoreDevice UUID)
xcrun devicectl device info details --device <identifier> | grep udid
```

Two different ids exist and they are not interchangeable:

- **CoreDevice identifier** (`47F2B82C-…`) — for `devicectl` and `xctrace`.
- **hardware UDID** (`00008110-…`) — for `expo run:ios --device`. Passing the CoreDevice id here
  fails with `No device UDID or name matching …`.

## 2. Build Release to the phone

```bash
bunx expo run:ios --device <hardware-udid> --configuration Release
```

Release matters: Hermes bytecode is optimized and the dev-tools overhead is gone. Debug numbers are
worthless (see [performance-findings.md](../performance-findings.md), 40–50% skew).

The dev variant installs as `app.vescape.dev` and can run side by side with the store build — check
you are profiling the right one.

## 3. Warm the tunnel, then record

```bash
xcrun devicectl device info details --device <identifier> >/dev/null &
sleep 2
xcrun xctrace record --device <identifier> --template "Time Profiler" \
  --attach <pid> --time-limit 95s --output run.trace
```

- **`xctrace` device lists go stale.** Without the `devicectl` call immediately before, `record` dies
  with `Timed out waiting for device to boot` while `xctrace list devices` still shows it online.
- **`--attach` by name fails.** It does not match the display name; get the pid from
  `xcrun devicectl device info processes --device <identifier> | grep <app>`.
- A failed run leaves a stub directory, and the next attempt aborts with `Trace file already
exists` — `rm -rf run.trace` first.

## 4. Export

```bash
xcrun xctrace export --input run.trace --toc          # list available tables
xcrun xctrace export --input run.trace \
  --xpath '/trace-toc/run[@number="1"]/data/table[@schema="time-profile"]' --output tp.xml
```

Useful schemas: `time-profile`, `potential-hangs`, `life-cycle-period`.

## 5. Parse the XML

Three traps, all of which produce empty output rather than an error:

- **Interning.** An element carries its payload once with `id=`; later mentions are empty elements
  with `ref=`. Resolve every node through an id table or you read blanks.
- **Nesting.** Frames sit under `tagged-backtrace`, so `row.find('backtrace')` misses them. Use
  `row.find('.//backtrace')`.
- **Threads.** Rows cover every thread. Filter on the `thread` element's `fmt` containing
  `Main Thread` before computing any "% of main thread" number.

Frames are leaf-first: `names[0]` is self time, the set is inclusive time.

## 6. Get the real foreground/background boundaries

Export `life-cycle-period` rather than timing the phases with a stopwatch. It reports exact
`Background` / `Foreground - Active` intervals. Guessing them misattributes hangs to the wrong
transition — in #420 a microhang sat on the _lock_, not the unlock it superficially resembled.

## Notes

- Watchdog kills (`0x8BADF00D`) never reach Sentry: `SentryCrash` cannot observe a `SIGKILL`.
  MetricKit is the only automated path.
- Symbolication gaps show as bare addresses. The dSYM is uploaded to Sentry per build and can be
  pulled from there when attribution matters.
