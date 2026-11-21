package expo.modules.vescapecore.service

internal object BoardProbeAutoStartGate {
    private var activeProbeCount = 0

    @Synchronized
    fun enter() {
        activeProbeCount += 1
    }

    @Synchronized
    fun leave() {
        activeProbeCount = (activeProbeCount - 1).coerceAtLeast(0)
    }

    @Synchronized
    fun isActive(): Boolean = activeProbeCount > 0
}
