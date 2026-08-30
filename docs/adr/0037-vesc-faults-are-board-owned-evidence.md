# VESC faults are Board-owned live evidence outside Ride History

VESC faults and Board Warnings remain separate. A VESC fault is firmware-authored live state from Refloat `ALLDATA`; a Board Warning is an app-authored detector finding. They have separate native storage, bridge events, indicators, sheets, and dismissal models. Combining them would hide which system produced the finding.

Native creates one durable **VESC Fault Occurrence** when the live Refloat fault code changes from none or another code. Repeated frames extend the same occurrence. A normal frame or direct code change closes it. Losing the Board Session proves neither clear nor reactivation, so an open occurrence remains unresolved and is rehydrated after process restart. Dismissal hides only that occurrence from the fault indicator; later activations start undismissed.

When an occurrence opens, native immediately copies up to five seconds from the existing recent decoded telemetry window into its **VESC Fault Capture**. This is a one-shot past snapshot: no future tail, open capture lifecycle, per-frame capture work, GPS, or Ride History dependency. The achieved sample rate is whatever the Board Session produced.

Opening the VESC faults drawer reads the official VESC terminal `faults` command once, provided the matching Board is connected and stopped. There is no separate Read button and no background polling. Vescape shows the raw `COMM_PRINT` output and then discards it. This on-demand **Controller Fault Log** is not parsed, persisted, deduplicated, or converted into a VESC Fault Occurrence or Board Warning. It remains available when automatic VESC Fault Collection is disabled.

There are no link baselines, automatic register reads, audits, register snapshots, or register-derived occurrences. Those mechanisms add lifecycle and deduplication complexity while mixing a retained controller log with the live Refloat signal. Existing telemetry fault columns and minute-bucket fault counts are removed without migration because the app is still in limited testing.

A default-on **VESC Fault Collection** App Setting stops new live occurrences, captures, and fault indication when disabled. Existing evidence remains readable and dismissible. Fault evidence survives Board removal from active use; the hard-delete/tombstone mismatch remains tracked separately in #428.
