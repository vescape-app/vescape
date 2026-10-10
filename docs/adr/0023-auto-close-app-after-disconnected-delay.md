# Auto close exits the app after a sustained board-less delay

Auto start (companion presence) means the app often wakes in the background when the board appears — and then stays alive forever after the board is switched off, holding a foreground service, the notification, and battery. Riders who never open the app manually end up with a permanently running app. Android-only, opt-in (Automation settings → Shutdown), delay 1–480 min in the UI (native validator accepts up to 1440).

## Decision

`BoardSessionController` owns an **Auto close** countdown: when the board phase leaves `Connected`/`Stale`, a native timer arms; when it expires the controller stops the foreground service, cancels the notification, and finishes the app task (`closeAppTask`). The timer lives native because JS is not guaranteed to be running in exactly the scenario this targets (background auto-started app).

Guard rules, checked when the timer fires:

- **Visible app postpones.** `ActivityManager.getMyMemoryState` importance ≤ `IMPORTANCE_FOREGROUND` means the user is looking at the app; the countdown re-arms instead of yanking the task away. (Our own foreground service reports importance 125, so a backgrounded app is still detected.)
- **Group Ride participation postpones — lobby observing does not.** The root layout starts lobby observe whenever the app is open, so `GroupRideObserver.active` is true for the app's whole life; only `participating` (joined or rejoining a specific ride) counts as deliberate board-less use.
- **Reconnect churn does not reset the countdown.** `Connecting`/`Rescanning`/etc. are not "linked": the reconnect loop retries indefinitely, so treating them as linked would mean auto close never fires. A dropout shorter than the delay reconnects and cancels the timer.
- **Companion cooldown is deliberately not armed.** Auto close is not a user exit; the board reappearing should be able to auto start the app again.

## Considered Options

- **JS-side timer.** Rejected: the target scenario is a background-started app where the JS runtime may be dead or frozen; native owns long-lived work (CLAUDE.md).
- **Treat in-flight reconnect phases as linked (CodeRabbit suggestion on PR #203).** Rejected: the reconnect loop never gives up, so the countdown would never expire — the exact failure mode the lobby-observe guard fix removed.
- **Stop only the service, keep the task.** Rejected: the lingering task resurrects the JS app in a half-alive state; closing the whole task matches the "app was never opened" mental model of auto start.

## Consequences

- A fired auto close records a local diagnostic (`auto_close_app`) and logs under `VescSession`; postpones log their reason.
- With auto start enabled, the app's lifetime becomes fully board-driven: appears with the board, disappears `autoCloseDelayMinutes` after it.
- iOS has no equivalent (no companion auto start, no task-finish API); the settings UI hides the Shutdown section there.
