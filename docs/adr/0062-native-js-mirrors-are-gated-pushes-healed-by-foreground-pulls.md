# Native pauses live JS mirrors in the background

On iOS, continuous telemetry events kept the background JS thread busy enough to trigger the CPU watchdog. Native keeps polling, recording and alerting in the background, and delivers live mirror events only to an active frontend with a listener. It drops missed events and repairs mirrors with current snapshots on foreground entry, which also brings clears across a whole missed Board Session into view.

Low-rate `onAppDataChanged` events bypass the foreground gate. JS still reloads durable data on foreground because JS can be torn down while the native service is writing.
