# Watch Mirror is fed without a Board Session

The Watch Mirror started as a wrist view of the Board, so the phone pushed to it only while a **Board Session** produced **Telemetry Samples** (ADR-0019). Riding without a connected Board is now a goal: a **Group Ride** needs only a phone **GPS Fix**, and **Navigation** does not need a Board either. We decided the phone feeds the Watch Mirror whenever it has something worth showing, not only during a Board Session. Without Board telemetry the wrist keeps its gauges and leaves them empty rather than showing "Board not connected".

## Decision

- **Each wrist stream is gated by its own source plus the wrist's wake level, never by the Board Session alone.** The phone pushes while that source is live and the Watch Mirror is awake (ADR-0033 wake levels).
- **The Group Ride is its own stream, the Group Ride Frame.** It is pushed at about 1 Hz while the Rider is joined, carrying the Rider's course, the phone map's span, and for every other Rider their offset from the Rider in metres, name, colour, battery and heat level. The phone derives everything, including warning levels from the shared telemetry thresholds. The wrist only draws it. It is not pushed in ambient: the wrist hides the Group Ride there.
- **The Watch Frame already works this way.** Its tick runs for the lifetime of the phone's core service, not per Board Session, so Navigation reaches the wrist without a Board: the Board lanes are empty, and the nav, position, course and span lanes are filled. The Group Ride Frame follows the same service-level ownership.

## Considered Options

- **One combined frame carrying the Group Ride too.** Rejected: the Watch Frame is fixed-width float lanes (ADR-0018), and a roster of any size does not fit. Folding it in would change the wire contract on four implementations and mix a 4 Hz Board stream with a 1 Hz Rider stream.
- **Keep everything Board-bound and show the Group Ride only during a Board Session.** Rejected: a Rider meeting their group on foot, or with the Board off, would get nothing on the wrist. The rider wants the wrist to show what the app shows.

## Consequences

- The wrist's "Board not connected" notice goes away. Phone-link problems (no phone, app missing) are still said, because the wrist cannot fix those itself.
- A phone with no Board can now keep a radio link to the wrist busy for a whole Group Ride. The wake-level gate and the ambient skip are what bound that cost.
