# Live map display motion

Measured GPS Fixes remain native truth. Ride Track, Navigation and Group Ride presence consume
measured coordinates, never display estimates. Each surface owns a native estimator instance:
one Kotlin implementation compiles into Android phone and Wear OS; one Swift implementation compiles
into iPhone and watchOS. Sources live under `modules/vescape-core/`, and the existing watch source
sharing mechanisms include them. Clocks and mutable animation state remain local to each surface.
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

The phone native input coordinator owns display source identity, replay rate adaptation, Board
Session generation, telemetry speed conversion/coalescing and input freshness. It emits complete,
bounded linear segments at input changes and segment/heading deadlines, never at animation-frame
rate. JS evaluates these segments for the point renderer and camera; it does not interpret GPS,
speed or source changes. Segment endpoints include correction, prediction-expiry and distance-budget
boundaries, so a stationary prefix can still lead to a future moving segment.

The Map Camera Controller remains the phone's single camera writer. It samples supplied segments
inside its existing spring loop. Position defaults to 3 rad/s and GPS camera heading to 1 rad/s; the GPS arrow uses
10 rad/s. The slower heading spring continues between GPS fixes and preserves angular velocity
when a new heading arrives. The 3D coin's arrow shows native GPS direction in GPS-heading, North up
and Free rotate modes; Compass uses phone heading. Approximate fixes hide GPS direction. The coin's
view annotation interpolates native-authored position segments on the UI thread, without per-frame
React updates or annotation-position events for touch hit testing. The playground retains the linear
Mapbox shape animator. The point stays responsive while the camera deliberately lags. Manual browsing, History
and preview gestures retain camera ownership. Watch renderers sample their own point controller
and apply their own slower camera response. Street map, route and rider use the same local clock.
LiveTrail geometry and styling are independent of this display estimate. Once the target is
stationary, springs have settled and the fling hold has expired, the camera requests no recurring
frames, including in follow mode. New display events, camera intents and future segment deadlines
wake it. A sampled follow target cannot continuously renew the fling hold.

## Developer tuning

Navigation Diagnostics and the Camera playground share session-only configuration and reset.
Native supplies the complete defaults, control metadata and validation; JS sends override intents
and presents validated values. Seven controls remain: prediction strength (50%), maximum prediction
distance (8 m), minimum direction movement (2 m), camera turn confirmation distance (3 m), camera
position response (3 rad/s), camera rotation response (1 rad/s, range 0.1–10 rad/s), and arrow rotation
response (10 rad/s). Descriptions explain units and lower/higher effects. Other safeguards remain
named native defaults rather than transported developer overrides. Correction duration has no control: it always
comes from accepted GPS cadence. Settings changes preserve the current point and unfinished
correction. Camera response changes preserve camera position and velocity.

Defaults include a 5–25 m GPS accuracy confidence ramp, 3 s GPS freshness, 1 s telemetry freshness,
8 s direction evidence window, 2 s direction retention, 1.5 s prediction horizon and an 8 m prediction
budget per fix. The configuration definitions live beside the native motion controllers, linked by parity
and exercised with the same behavioral fixtures. Test settings travel to watches through the
existing cold settings channel; measurements and animation state do not travel with them.

The playground supplies isolated synthetic measurements and Board speeds to the production motion
controller and point adapter. Synthetic inputs never reach native GPS, recording or Navigation.

## Delivery and lifecycle

Display source identity changes on replay entry/exit. It orders resets independently of measurement
time; delayed data from an older source cannot restore its animation. The native input coordinator adapts Session Clock offset and replay rate without rewriting measured
timestamps. Display events carry native monotonic time as well as display time/rate; the renderer
calibrates their offset using a synchronous command response, so queued bridge delivery does not
restart a segment's clock.

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

## Accuracy and optional comparison evidence

Android preserves absent `Location` accuracy as null. iOS maps negative `horizontalAccuracy` to nil;
cached snapshots and replay preserve optional accuracy. The persisted last map coordinate is a
fallback with no accepted measurement accuracy/time and never enters the estimator. Current Watch Frames carry absent accuracy
in the accuracy lane as NaN and decode it to null; legacy frames have no predictive motion facts.
A valid clock/source envelope still decodes when only accuracy is unusable. No producer supplies a
fabricated good accuracy to enable prediction.

One native classification policy rejects absent, negative, non-finite or overly poor accuracy,
malformed coordinates and stale measurements. A newer unusable fix disables prediction immediately;
an existing bounded correction may finish before holding. Rejected fixes advance event ordering but
never cadence anchors. An old-source or out-of-order event cannot disable newer valid prediction.
A fresh usable fix reacquires normally. Initial acquisition without a usable fix leaves the existing
map fallback distinct from an accepted position. Measured recording and other GPS consumers keep
their existing contracts.

Two independent, session-only toggles default off. **Show smoothed trail** draws the evaluated display
segments in fixed white with black casing; it never substitutes the measured LiveTrail. Native
samples moving segments at up to 5 Hz, additionally including input/segment boundaries, retains at
most 300 samples for 60 seconds, and batches geometry across the bridge. **Show raw GPS point**
steps a ring at the newest finite measured coordinate, including rejected/unknown-accuracy fixes;
it does not interpolate or substitute an older accurate fix. Amber marks rejection/unknown accuracy,
and reduced opacity marks stale data. Source/event ordering applies to both. Neither affects the
camera's ordinary displayed-point target.

Navigation Diagnostics shows the legend, raw quality/staleness and measured-to-displayed distance.
Native builds full diagnostics only for a visible diagnostics consumer (at most once per second).
Turning comparison overlays off stops their collection; hiding the map clears their transient
history. Diagnostics can consume native state independently while the map renderer sleeps.
Backgrounding or removing the final consumer cancels display/debug timers and subscriptions, without
changing GPS collection, Ride Recording or watch delivery. Shared fixtures exercise idle work,
replay clocks, source/session ordering, unusable acquisition/recovery, independent toggles and
teardown, alongside the riding-model fixtures.
