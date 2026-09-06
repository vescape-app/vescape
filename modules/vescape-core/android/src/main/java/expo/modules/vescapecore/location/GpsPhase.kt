package expo.modules.vescapecore.location

/**
 * GPS phase reported to JS in Live State. Native owns the phase; JS renders it and never infers one
 * from a boolean.
 *
 * @parity /modules/vescape-core/ios/location/GpsPhase.swift
 * @parity /modules/vescape-core/src/index.ts `GpsPhase`
 */
internal enum class GpsPhase(val wireValue: String) {
    Idle("idle"),
    Starting("starting"),
    Active("active"),
    Error("error"),
    ;

    companion object {
        /**
         * The one place the phase is decided, so both platforms answer the same for the same
         * monitor state. [retained] means a location manager is held but updates may not run yet —
         * the permission dialog is open, or the foreground service that arms the monitor is still
         * starting. [updatesStarted] means location updates were actually requested and fixes can
         * arrive.
         *
         * A standing [error] wins over everything: it is the same string the Live State `error`
         * field carries, so the phase and the error can never disagree.
         *
         * @parity /modules/vescape-core/ios/location/GpsPhase.swift `resolve`
         */
        fun resolve(retained: Boolean, updatesStarted: Boolean, error: String?): GpsPhase = when {
            error != null -> Error
            updatesStarted -> Active
            retained -> Starting
            else -> Idle
        }
    }
}
