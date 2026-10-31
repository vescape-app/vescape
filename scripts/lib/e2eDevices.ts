import { bootAvd, isAvdRunning, listAvds, type Avd } from './avds.ts'
import { listAdbDevices, pickDevice, type AdbDevice } from './devices.ts'

type Choice = { kind: 'attached'; device: AdbDevice } | { kind: 'avd'; avd: Avd }

/** Resolve the entire pair before any build. The same explicit targets go to every child runner. */
export async function e2eDevices(
  needsWatch: boolean,
  requested: string | null,
  requestedWatch: string | null,
) {
  const attached = listAdbDevices()
  const avds = listAvds()
  const choices: Choice[] = attached
    .filter((device) => !device.isWatch && (!needsWatch || device.isEmulator))
    .map((device) => ({ kind: 'attached', device }))
  for (const avd of avds.filter((avd) => !avd.isWatch)) {
    if (!attached.some((device) => device.name === avd.name)) choices.push({ kind: 'avd', avd })
  }
  const phoneChoice = await pickDevice({
    title: 'E2E phone',
    items: choices,
    id: (choice) => (choice.kind === 'avd' ? choice.avd.name : choice.device.name),
    label: (choice) => (choice.kind === 'avd' ? `boot ${choice.avd.label}` : choice.device.name),
    aliases: (choice) =>
      choice.kind === 'avd'
        ? []
        : [choice.device.serial, choice.device.expoName, choice.device.hardware],
    hint: (choice) => (choice.kind === 'avd' ? 'emulator' : choice.device.serial),
    requested,
    cacheKey: 'e2e-phone',
    emptyMessage: needsWatch
      ? 'Phone + watch suites require a phone AVD with Google Play services.'
      : 'No Android phone or phone AVD available.',
  })
  const watch = needsWatch
    ? await pickDevice({
        title: 'E2E Wear emulator',
        items: avds.filter((avd) => avd.isWatch),
        id: (avd) => avd.name,
        label: (avd) => avd.label,
        aliases: (avd) =>
          attached
            .filter((device) => device.isWatch && device.name === avd.name)
            .map((device) => device.serial),
        hint: (avd) => (isAvdRunning(avd.name) ? 'running' : 'boot emulator'),
        requested: requestedWatch ?? process.env.WEAR_AVD ?? null,
        cacheKey: 'wear-avd',
        emptyMessage: 'Watch suites require a Wear OS AVD with Google Play services.',
      })
    : null
  const boot = [phoneChoice.kind === 'avd' ? phoneChoice.avd : null, watch].filter(
    (avd): avd is Avd => avd !== null,
  )
  for (const avd of boot) if (!isAvdRunning(avd.name)) bootAvd(avd.name)
  const name = phoneChoice.kind === 'avd' ? phoneChoice.avd.name : phoneChoice.device.name
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    const devices = listAdbDevices()
    const phone = devices.find(
      (device) =>
        !device.isWatch &&
        (phoneChoice.kind === 'attached'
          ? device.serial === phoneChoice.device.serial
          : device.name === name),
    )
    const wrist = watch
      ? devices.find((device) => device.isWatch && device.name === watch.name)
      : null
    const ready = (device: AdbDevice) =>
      new TextDecoder()
        .decode(
          Bun.spawnSync(['adb', '-s', device.serial, 'shell', 'getprop', 'sys.boot_completed'], {
            timeout: 10_000,
          }).stdout,
        )
        .trim() === '1'
    if (phone && (!watch || wrist) && [phone, ...(wrist ? [wrist] : [])].every(ready))
      return { phone, watch: wrist }
    await Bun.sleep(1000)
  }
  throw new Error('E2E devices did not finish booting within five minutes')
}
