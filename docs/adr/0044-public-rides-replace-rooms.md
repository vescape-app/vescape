# Public Rides replace rooms

Accepted. Replaces [ADR-0020](0020-group-ride-server-relayed-native-presence.md).

Riders are Accounts with unique nicks. Native owns the Public Ride switch, hours expiry, Board Session activation, socket reconnect and location delivery on Android and iOS. JS renders state and sends intents. Room creation, membership, discovery and room cues are retired.

The Public Ride switch starts sharing when a Board Session connects by default. After selecting a timed or Always Public Ride, the rider can start sharing manually from the phone. Manual sharing keeps GPS active with the app in the background and follows the selected expiry. **Wait for my board** restores Board Session activation without changing the selection. The manual override is held only in memory, so restarting the app process restores Board Session activation.

Nearby discovery works while private, using a current or last known location without storing the look-around request. Public positions keep Privacy Zone gates. Signals and hazards retain their explicit location sharing and independent lifetimes. Watches receive nearby public riders.

The server derives Crew Rides from stored Public Ride positions. Private Ride Recording stays local. Solo rides are not listed publicly. See PRD #668 for the agreed Crew Ride and friends behavior.

The deployment cutoff in vescape-app/vescape-server#59 remains pending. No production version or Online Block cutoff changes are made here. Server deployment and blocking old clients are separate operational steps.
