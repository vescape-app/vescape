package expo.modules.vescapecore.service

import android.content.pm.ServiceInfo

/**
 * One kind of work that keeps [CoreForegroundService] and its notification alive (ADR 0035, #405).
 *
 * The service is shared: a Board Presence Scan, a Board Session, GPS monitoring, and a Group Ride
 * all run inside the *same* service instance. Releasing one of them must never tear down the
 * presentation another still needs, so ownership is tracked explicitly under these names instead of
 * being re-derived from a boolean soup at each teardown site.
 *
 * [wireValue] is the connection-trace vocabulary, so a released owner logs the same word everywhere.
 *
 * @platform-diff iOS has no foreground service. Its peer for the foreground→lock handoff is
 * `PresenceScanBackgroundTask`; durable ride lifetime comes from the location anchor (ADR 0034).
 */
internal enum class ForegroundWork(
    val wireValue: String,
    val requiresConnectedDevice: Boolean = false,
    val requiresLocation: Boolean = false,
) {
    /** Temporary: the five-second Board Presence Scan and nothing else. */
    PresenceScan("presence_scan", requiresConnectedDevice = true),
    BoardSession("board_session", requiresConnectedDevice = true),
    Gps("gps", requiresLocation = true),
    GroupRide("group_ride"),
}

/** What the service owes the rider for a given owner set. [traceValue] is the `service_state` field. */
internal enum class ForegroundPresentation(val traceValue: String) {
    /** Nothing is left to show — cancel the notification and stop the service. */
    Stopped("stopped"),

    /** Only the Presence Scan remains: the temporary determinate progress notification. */
    Searching("searching"),

    /** Durable work remains (Board Session, GPS, Group Ride): the normal session notification. */
    Session("foreground"),
}

/** Result of one reconcile pass, so acquisitions and releases can be traced without diffing sets. */
internal data class ForegroundWorkChange(
    val owners: Set<ForegroundWork>,
    val acquired: Set<ForegroundWork>,
    val released: Set<ForegroundWork>,
) {
    val hasWork: Boolean get() = owners.isNotEmpty()
    val presentation: ForegroundPresentation get() = foregroundPresentationFor(owners)
    val serviceType: Int get() = foregroundServiceType(owners)
}

internal fun foregroundPresentationFor(owners: Set<ForegroundWork>): ForegroundPresentation = when {
    owners.isEmpty() -> ForegroundPresentation.Stopped
    owners == setOf(ForegroundWork.PresenceScan) -> ForegroundPresentation.Searching
    else -> ForegroundPresentation.Session
}

/**
 * Explicit foreground-work owner tracking for [CoreForegroundService] (#405).
 *
 * Owners are reconciled in one place from each subsystem's own truth, so no site can forget a
 * release and strand the service, and no release can drop presentation another owner still needs.
 * Pure and Android-free apart from the service-type bitmask, so the retention rules are unit-tested
 * without a running service.
 */
internal class ForegroundWorkOwnership {
    private val held = linkedSetOf<ForegroundWork>()

    @Synchronized
    fun reconcile(vararg state: Pair<ForegroundWork, Boolean>): ForegroundWorkChange {
        val acquired = linkedSetOf<ForegroundWork>()
        val released = linkedSetOf<ForegroundWork>()
        for ((work, active) in state) {
            if (active && held.add(work)) acquired += work
            if (!active && held.remove(work)) released += work
        }
        return ForegroundWorkChange(owners = held.toSet(), acquired = acquired, released = released)
    }

    @Synchronized
    fun holds(work: ForegroundWork): Boolean = work in held

    @Synchronized
    fun owners(): Set<ForegroundWork> = held.toSet()

    val hasWork: Boolean
        @Synchronized get() = held.isNotEmpty()

    val presentation: ForegroundPresentation
        @Synchronized get() = foregroundPresentationFor(held)

    val serviceType: Int
        @Synchronized get() = foregroundServiceType(held)
}

/**
 * Foreground-service type Android 14+ checks at `startForeground()`, derived from the owner set so
 * the declared type can never disagree with the work actually running.
 */
internal fun foregroundServiceType(owners: Set<ForegroundWork>): Int {
    var type = 0
    if (owners.any { it.requiresConnectedDevice }) {
        type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
    }
    if (owners.any { it.requiresLocation }) {
        type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
    }
    return type
}

/**
 * Type for a start that is *about* to do BLE work whose owner is not registered yet — the Presence
 * Scan's immediate foreground start and the Companion wake. CONNECTED_DEVICE is asserted on top of
 * whatever the current owners already require.
 *
 * This is a foreground-service *type*, not a promotion: both callers already start the service in
 * the foreground. There is deliberately no regular-service-to-foreground path (#405).
 */
internal fun foregroundServiceTypeWithConnectedDevice(owners: Set<ForegroundWork>): Int =
    foregroundServiceType(owners) or ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
