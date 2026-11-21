package expo.modules.vescapecore.location

/**
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
