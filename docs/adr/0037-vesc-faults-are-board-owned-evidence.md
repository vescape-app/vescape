# VESC faults are Board-owned evidence separate from Board Warnings

VESC faults (firmware-authored live state from Refloat `ALLDATA`) and Board Warnings (app-authored detector findings) MUST remain strictly separate in storage, events, indicators, and dismissal so riders always know which system produced a finding.

- **Never auto-close an open VESC Fault Occurrence on disconnect:** losing the BLE link proves neither clear nor reactivation, so open occurrences stay unresolved across disconnects and restarts until a normal frame or new fault code arrives.
- **Controller Fault Log is ephemeral display-only:** the terminal `faults` command output (`COMM_PRINT`) is shown once and discarded — NEVER parse, persist, deduplicate, or convert it into VESC Fault Occurrences or Board Warnings.
