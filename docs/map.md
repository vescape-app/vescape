# Live map display motion

Measured GPS Fixes remain native truth. Ride Track, Navigation and Group Ride presence consume
measured coordinates, never display estimates. Each visible map owns transient display motion:
TypeScript on the phone, Kotlin on Wear OS, and the shared Swift implementation on watchOS.
There is no phone animation timeline in Live State or Watch Frames.

## Point and camera

A new accepted fix corrects from the current display position at constant velocity over the median
of the last five valid measurement intervals (bounded to 100–3000 ms). Rejected, stale, duplicate and
out-of-order fixes do not become cadence anchors. Initial acquisition and source changes initialize
immediately. A measurement gap beyond GPS freshness discards direction evidence and cadence history.

Prediction adds velocity independently of correction. Its default maximum is 50% of fresh Board
speed magnitude, scaled by GPS accuracy and meaningful displacement. A speed update first preserves
the position already drawn, then changes future velocity; it does not restart GPS correction.
Zero Board speed, missing/expired telemetry, unusable GPS or expired direction evidence disables
prediction. Fresh GPS alone still produces linear correction without a Board Session.

A shared travel-direction estimator accepts spatially separated points. Point prediction uses a
shorter window than camera heading. Camera presentation confirms a candidate from net displacement
and newly accepted, spatially separated fixes while retaining its last confirmed heading. The
shared estimator supplies heading through the configurable camera window; repeated stationary
fixes do not advance confirmation. Defaults require 3 m and
2 fixes for ordinary turns, and 8 m and 4 fixes for near reversals. With good GPS and 1 Hz fixes, 0.5 m/s travel can supply four meaningful steps in
16 seconds; poorer accuracy or slower fix delivery can take longer. Rocking contributes little net
displacement. Candidate evidence survives the estimator's rolling window, but not a data gap or
source reset. Motor sign never chooses geographic direction. Unknown GPS heading holds the last
camera heading, without selecting compass or north.

When a fix arrives behind the displayed point, its longitudinal correction consumes subsequent
forward velocity before allowing backward movement. Lateral correction remains available. This
avoids the normal braking bounce, at the cost of a small temporary display offset after overshoot.
Persistent reliable disagreement for three seconds enables explicit recovery, capped at 2 m/s;
Navigation Diagnostics identifies this as `persistent-overshoot-recovery`. Reliable reversal changes
the direction axis and does not wait for that recovery timer.

The Map Camera Controller remains the phone's single camera writer. It samples the ongoing point
estimate inside its existing spring loop. Position defaults to 3 rad/s and GPS camera heading to 1 rad/s; the GPS arrow uses
10 rad/s. The slower heading spring continues between GPS fixes and preserves angular velocity
when a new heading arrives. Only GPS-heading mode draws the travel arrow; North up, Free rotate
and Compass modes use the phone-compass arrow instead. The point stays responsive while the camera deliberately lags. Manual browsing, History
and preview gestures retain camera ownership. Watch renderers sample their own point controller
and apply their own slower camera response. Street map, route and rider use the same local clock.
LiveTrail geometry and styling are independent of this display estimate.

## Developer tuning

Navigation Diagnostics and the Camera playground share session-only configuration and reset.
Controls name their units and clamp valid ranges. Correction duration has no control: it always
comes from accepted GPS cadence. Settings changes preserve the current point and unfinished
correction. Camera response changes preserve camera position and velocity.

Defaults include a 5–25 m GPS accuracy confidence ramp, 3 s GPS freshness, 1 s telemetry freshness,
8 s direction evidence window, 2 s direction retention, 1.5 s prediction horizon and an 8 m prediction
budget per fix. The configuration definitions live beside the motion controllers, linked by parity
and exercised with the same behavioral fixtures. Test settings travel to watches through the
existing cold settings channel; measurements and animation state do not travel with them.

The playground supplies isolated synthetic measurements and Board speeds to the production motion
controller and point adapter. Synthetic inputs never reach native GPS, recording or Navigation.

## Delivery and lifecycle

Display source identity changes on replay entry/exit. It orders resets independently of measurement
time; delayed data from an older source cannot restore its animation. Display-only clock metadata
adapts Session Clock offset and replay rate at the renderer boundary without rewriting measured timestamps.

Watch Frames append only missing measured facts: source identity, fix time, send time, accuracy and
GPS/telemetry age and source clock rate. Integer millisecond clocks use two Float32 lanes with a 2²⁰ base. Watches estimate
receive-time deltas against session-time deltas scaled by the producer rate, so arbitrary clock
offsets do not affect animation and excess transport delay ages both inputs. The first frame's one-way transit time cannot be known
without synchronized clocks. Prediction is bounded even during this initial uncertainty.

Older Wear decoders skip appended lanes. Older watchOS decoders require exactly 13 lanes, so the
phone sends that layout until an optional wake-heartbeat capability byte advertises support.
New watches accept legacy frames with their existing interpolation and no prediction.

Phone display subscriptions and animation stop while hidden or backgrounded; watch maps stop in
ambient or when their surface disappears. Native GPS collection, recording and watch delivery keep
their existing independent lifetimes.
