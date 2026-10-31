package expo.modules.vescapecore.navigation

/**
 * Reroute Distance setting contract: how far the rider may be from the Navigation path before
 * [NavigationController] recalculates it. Its own file so the persistence host can compile it.
 *
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `defaultRerouteDistanceMeters`
 * @parity /modules/vescape-core/src/index.ts `NAVIGATION_REROUTE_DISTANCE`
 */
const val DEFAULT_REROUTE_DISTANCE_METERS = 50.0
val REROUTE_DISTANCE_RANGE = 1.0..1000.0
