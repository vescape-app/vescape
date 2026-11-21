# Battery SoC Estimate combines DC IR compensation and a bounded trailing median

Display percentage and battery Alert Rules MUST read one shared **Battery SoC Estimate** so on-screen % and alerts never diverge. Raw pack voltage stays unmodified in Telemetry Samples.

- **IR compensation:** `V_corrected = V_measured + I_battery × R_pack` (VESC discharge current is positive). Cell presets MUST use **DC internal resistance at 50% SoC (~10 A pulse)** — never AC 1 kHz impedance, which is ~half DC and under-compensates sag (if a datasheet only gives AC, use 2× AC).
- **Trailing median:** rejects residual sag transients without mean-drag. The configurable window is hard-capped at **120 s** as a safety bound so low-battery alerts cannot lag true discharge into cutoff.
- **History:** recomputes the Estimate per sample on read; minute buckets store raw aggregates only.
