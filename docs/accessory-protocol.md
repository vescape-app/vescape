# Vescape Accessory Protocol v1

Status: implementation draft for the PoC. Product behavior is in [accessories.md](./accessories.md). This protocol is not implemented yet. Timing, rate, and size limits below are proposed PoC defaults, not measured reliability guarantees.

## Ownership

Firmware declares hardware capabilities, measures sensors, and renders outputs. Vescape owns saved calibration, current-Board selection, riding detection, tilt mapping, and speed-based braking detection. Native runs this work while the screen is locked. The wire protocol contains no Board IDs, tilt calibration, raw VESC commands, or LED frames.

V1 recognizes `ground_clearance` and `brake_light`. Dispatch by capability type and address by capability ID; do not infer behavior from accessory names or sensor models. Future capability types get their own schemas and handlers.

## BLE transport

Assign this custom GATT service and characteristic set for the draft:

| UUID                                   | Purpose                   | Properties          |
| -------------------------------------- | ------------------------- | ------------------- |
| `8d53dc10-1db7-4cd3-868b-8a527460aa84` | Vescape Accessory service | Advertised          |
| `8d53dc11-1db7-4cd3-868b-8a527460aa84` | App to accessory          | Write with response |
| `8d53dc12-1db7-4cd3-868b-8a527460aa84` | Accessory to app          | Notify              |

These are project-assigned UUIDs, not Bluetooth SIG assigned services. Replace the spike's Nordic UART service on both sides together; that generic service also identifies other hardware and is not accessory identity.

Both directions carry UTF-8 newline-delimited JSON. Each message is one compact object followed by LF. Examples below represent complete lines; send the trailing LF. Split outgoing bytes to fit the negotiated ATT payload. Reassemble bytes before decoding UTF-8 or JSON. Handle partial lines and multiple lines per received chunk. Serialize all chunks of one outgoing message before the next message.

Maximum line length is 4096 bytes excluding LF. An oversized line, invalid UTF-8, or malformed JSON ends the protocol session and disconnects BLE. Clear receive and transmit buffers on disconnect. No plain-text logs or echo replies on these characteristics; use serial for diagnostics.

BLE write completion confirms transport delivery, not command application. Application acknowledgements are defined below.

## Identity, compatibility, and enrollment

`accessoryId` is a factory-provisioned or once-generated persistent UUID that survives reboot and ordinary firmware updates. A display name or BLE address is not this identity. Capability IDs are unique within an accessory and stable across firmware updates. Saved settings key on accessory ID plus capability ID.

An advertised service makes a device discoverable. The rider explicitly adds it before automatic operation. Only saved accessories auto-connect. Read the manifest on every connection and validate identity, version, and recognized capability schemas before using saved settings. If measurement limits change and saved calibration no longer fits, show setup required and keep that binding inactive.

The bootstrap `hello` and `manifest` envelope remains readable across versions. Operational v1 schemas ignore unknown optional fields. Unknown capability types can be shown as unsupported while recognized types work. Unsupported protocol versions allow an incompatibility explanation but no operational commands. New optional fields must have omission semantics that preserve existing behavior; changing existing meanings requires a version bump.

Stable IDs are identifiers, not authentication. This PoC enrollment does not claim protection from an accessory impersonating an enrolled ID. Authenticated enrollment is an explicit remaining protocol concern before use beyond controlled prototypes.

## Session handshake

1. Connect and subscribe to notifications.
2. App sends `hello` with a fresh random session UUID and supported versions.
3. Firmware resets volatile runtime state, selects v1 if supported, and returns its manifest.
4. App validates the manifest, then sends current configuration/state for enrolled capabilities.
5. Measurements begin only after an enabled configuration is applied. Light output begins when a state command is applied.

```json
{
  "type": "hello",
  "requestId": 1,
  "sessionId": "b06b9d76-6c73-4d70-a763-d933b294c45b",
  "supportedVersions": [1]
}
```

Example manifest for an illustrative sensor build. Ranges and rates must describe the actual firmware's supported operation; these example numbers are not VL53L0X guarantees.

```json
{
  "type": "manifest",
  "requestId": 1,
  "sessionId": "b06b9d76-6c73-4d70-a763-d933b294c45b",
  "protocolVersion": 1,
  "accessoryId": "b36ed5bd-1d24-460c-8034-aaeaefc5d016",
  "name": "Clearance sensor",
  "firmwareVersion": "0.1.0",
  "capabilities": [
    {
      "id": "clearance",
      "type": "ground_clearance",
      "unit": "cm",
      "range": { "min": 3, "max": 100 },
      "ratesHz": [10, 20, 30]
    }
  ]
}
```

A light advertises a capability object such as:

```json
{ "id": "rear_light", "type": "brake_light" }
```

If there is no common version, return the same manifest envelope with `protocolVersion: null` and `supportedVersions`, then accept no operational commands. If a repeated hello carries the same session ID and request ID, resend the manifest without resetting runtime. A new session ID resets runtime and invalidates previous commands.

Every post-hello message carries the agreed session ID. Ignore messages from other sessions; they never renew a timeout. A disconnect invalidates the session. An app re-handshake also clears its old queues and callback ownership before sending the new hello.

## Requests and acknowledgements

Request IDs are strictly increasing integers within a session. App sends at most one outstanding request per accessory, with request chunks serialized. Coalesce unsent state updates to the latest desired state. Fresh readings use a separate notification stream; they do not need acknowledgements.

An acknowledgement means the command was validated and applied, not merely queued. It does not prove a physical LED illuminated. Unsupported values and invalid fields return errors without applying partial changes.

Commands always set desired values. They never toggle or cycle. Retrying the same request ID must not restart an animation or reapply a transition. Firmware retains the latest request's response for duplicate replies, rejects older IDs as `stale_request`, and rejects reuse of an ID with a different body as `request_id_reused`. Duplicate retries do not extend command leases; a deliberate renewal uses a new request ID.

Example error:

```json
{
  "type": "error",
  "sessionId": "b06b9d76-6c73-4d70-a763-d933b294c45b",
  "requestId": 2,
  "code": "invalid_argument",
  "message": "rateHz must be positive"
}
```

V1 error codes: `invalid_argument`, `unknown_capability`, `unsupported_message`, `not_ready`, `hardware_error`, `stale_request`, `request_id_reused`. A well-formed unknown request returns `unsupported_message`; an unknown unsolicited message is ignored without renewing any timeout.

## Ground-clearance configuration

```json
{
  "type": "configure",
  "sessionId": "b06b9d76-6c73-4d70-a763-d933b294c45b",
  "requestId": 2,
  "capabilityId": "clearance",
  "enabled": true,
  "rateHz": 20
}
```

```json
{
  "type": "ack",
  "sessionId": "b06b9d76-6c73-4d70-a763-d933b294c45b",
  "requestId": 2,
  "capabilityId": "clearance",
  "applied": { "enabled": true, "rateHz": 20 },
  "leaseMs": 2000
}
```

Select the nearest supported rate, choosing the lower rate on a tie, and acknowledge the actual rate. `enabled: false` stops actual measurement, including a sensor's continuous measurement mode, while preserving BLE connectivity. Require `rateHz` in both forms to keep commands complete and replayable. Capability configuration is volatile; reboot starts disabled.

Vescape renews the complete configuration while it is needed. Measure while riding or while the sensor screen is open. Only fresh Board riding state, complete valid calibration, and fresh valid sensor samples permit sensor-driven tilt. Screen preview alone never permits tilt. Losing Board telemetry stops tilt and disables measurements unless the screen still needs them.

Readings identify the capability and contain a per-capability sequence number and sample time in milliseconds since the current protocol session began:

```json
{"type":"reading","sessionId":"b06b9d76-6c73-4d70-a763-d933b294c45b","capabilityId":"clearance","seq":1,"sampleTimeMs":125,"status":"ok","value":12.4}
{"type":"reading","sessionId":"b06b9d76-6c73-4d70-a763-d933b294c45b","capabilityId":"clearance","seq":2,"sampleTimeMs":175,"status":"out_of_range"}
{"type":"reading","sessionId":"b06b9d76-6c73-4d70-a763-d933b294c45b","capabilityId":"clearance","seq":3,"sampleTimeMs":225,"status":"error"}
```

`ok` requires a finite numeric value in the declared range. Other statuses omit `value`. A driver unable to distinguish missing hardware from no target must report `error`, rather than inventing a valid distance. Emit status samples at the configured cadence while enabled, including persistent error/out-of-range states.

Sequence numbers start at 1 and increase across measurement pauses within a session. Drop duplicate or older samples. Sample timestamps use the accessory's monotonic clock; do not subtract them directly from phone timestamps. The app uses local monotonic receipt time for the missing-stream timeout and sequence/timestamp progress to reject regressions. This is a PoC freshness mechanism, not a claim of synchronized clocks or bounded end-to-end latency.

Keep only the latest unsent reading per capability to avoid replaying a backlog. Once transmission of a line has started, finish that line before sending another. Out-of-range/error readings release tilt immediately through existing smooth cancellation; valid readings that stop arriving release it on the stale timeout. Acknowledgements do not refresh sensor freshness.

## Brake-light state

```json
{
  "type": "state",
  "sessionId": "b06b9d76-6c73-4d70-a763-d933b294c45b",
  "requestId": 3,
  "capabilityId": "rear_light",
  "telemetry": "available",
  "mode": "braking",
  "parked": "glow"
}
```

```json
{
  "type": "ack",
  "sessionId": "b06b9d76-6c73-4d70-a763-d933b294c45b",
  "requestId": 3,
  "capabilityId": "rear_light",
  "applied": { "telemetry": "available", "mode": "braking", "parked": "glow" },
  "leaseMs": 2000
}
```

`mode` is `riding`, `braking`, `hard_braking`, or `not_riding`. `parked` is `off` or `glow`, and affects output only in `not_riding`. Firmware interprets these semantic states and owns brightness, color, and timing. Renewing an unchanged state does not restart blink phase.

For absent/stale Board telemetry, use this complete replacement state; omit `mode`:

```json
{
  "type": "state",
  "sessionId": "b06b9d76-6c73-4d70-a763-d933b294c45b",
  "requestId": 4,
  "capabilityId": "rear_light",
  "telemetry": "unavailable",
  "parked": "glow"
}
```

Firmware chooses how telemetry-unavailable looks. Connection loss and expired app commands are detected locally and may have different firmware-defined behavior. There is no outgoing “disconnected” command.

Parked preview sends the same state schema with `preview: true`. This optional field defaults to false and labels simulated state; it makes no claim that Board telemetry exists. Permit `telemetry: "unavailable"` plus a mode only when preview is true. Vescape sends the actual current state immediately on closing preview. Firmware's lease also ends preview if the app disappears.

## PoC timing and failure defaults

| Setting                    | Proposed default                                          |
| -------------------------- | --------------------------------------------------------- |
| Preferred sensor rate      | 20 Hz, resolved against manifest and confirmed by ack     |
| Missing sensor stream      | 300 ms, starting at enabled ack or latest accepted sample |
| Runtime command lease      | 2000 ms per capability                                    |
| App renewal interval       | 500 ms, send state changes immediately                    |
| Request response timeout   | 500 ms; retry once with the same ID                       |
| Handshake response timeout | 3000 ms; disconnect and use normal reconnect policy       |

For a selected rate below 10 Hz, use `max(300 ms, 3 * sample period)` for missing-stream detection. These values need validation under concurrent Board and accessory BLE traffic on Android and iOS.

Any second request timeout marks the accessory unavailable, cancels its active sensor binding, and disconnects it for a fresh handshake. A malformed response follows the same failure path. Firmware never renews a lease on malformed, rejected, duplicate, or wrong-session commands. On lease expiry or disconnect it stops measurements and hands light output to its local unavailable behavior.

If the Board link is itself gone, the app cannot promise to deliver a neutral command. Clear native input ownership and pending writes; receiver-side Board timeout remains the final fallback. If only the accessory dies and the Board link remains usable, use the existing smooth Remote Tilt cancellation.

## Implementation checks

- Split messages at every byte boundary, including UTF-8 characters; also accept concatenated lines.
- Reject oversized and malformed messages without an unbounded receive buffer.
- Exercise version rejection, unknown capabilities, and changed capability limits after reconnect.
- Drop an ack, retry, and confirm that a light animation does not restart or a lease extend twice.
- Stop app renewals with BLE connected; observe sensor standby and firmware-owned light fallback.
- Stop readings with configuration acks still arriving; observe tilt cancellation.
- Reconnect with queued old commands; confirm they cannot affect the new session.
- Validate measurement standby and locked-screen operation with current development builds on both platforms.

## Remaining implementation work

Inspect and reuse the existing native riding-state predicate and Board telemetry freshness rules. Define braking smoothing and sensitivity thresholds in the app, outside this wire protocol. Choose the real sensor manifest limits from driver configuration and measurements. Authenticated enrollment and simultaneous front/rear tilt arbitration remain outside this PoC draft.
