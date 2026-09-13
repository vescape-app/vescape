package expo.modules.vescapecore.accessory

import kotlin.math.abs

/** Speed is km/h, clock is monotonic. PoC defaults documented in docs/accessories.md.
 * @parity /modules/vescape-core/ios/accessory/BrakeLight.swift
 */
class BrakeLightDetector {
    private var previousSpeed: Double? = null
    private var previousAt: Long? = null
    private var deceleration = 0.0
    var mode: String? = null
        private set

    fun clear() { previousSpeed = null; previousAt = null; deceleration = 0.0; mode = null }

    fun sample(speedKmh: Double, riding: Boolean, at: Long, sensitivity: Int) {
        if (!speedKmh.isFinite()) { clear(); return }
        val speed = abs(speedKmh) / 3.6
        val oldSpeed = previousSpeed
        val dt = previousAt?.let { at - it }
        previousSpeed = speed
        previousAt = at
        if (!riding) { deceleration = 0.0; mode = "not_riding"; return }
        if (oldSpeed == null || dt == null) { mode = "riding"; return }
        if (dt <= 0 || dt > 500) { deceleration = 0.0; mode = null; return }
        val seconds = dt / 1000.0
        val alpha = seconds / (0.2 + seconds)
        deceleration += alpha * ((oldSpeed - speed) / seconds - deceleration)
        val scale = 1.5 - sensitivity / 100.0
        val braking = scale * if (mode == "braking") 0.75 else 1.0
        val hard = scale * if (mode == "hard_braking") 2.25 else 3.0
        mode = when { deceleration >= hard -> "hard_braking"; deceleration >= braking -> "braking"; else -> "riding" }
    }
}

/** Persisted per Accessory capability; automatic state follows whichever Board is current.
 * @parity /modules/vescape-core/ios/accessory/BrakeLight.swift `BrakeLightSettings`
 * @parity /modules/vescape-core/src/index.ts `BrakeLightSettings`
 */
data class BrakeLightSettings(val sensitivity: Int = 50, val parked: String = "off") {
    fun valid() = sensitivity in 1..100 && parked in setOf("off", "glow")
    fun toMap(): Map<String, Any?> = mapOf("sensitivity" to sensitivity, "parked" to parked)
}

/** @parity /modules/vescape-core/ios/accessory/BrakeLight.swift `BrakeLightController` */
class BrakeLightController {
    data class Key(val accessoryId: String, val capabilityId: String)
    private class Light(var settings: BrakeLightSettings = BrakeLightSettings()) {
        val detector = BrakeLightDetector()
        var preview: String? = null
    }
    private val lights = linkedMapOf<Key, Light>()
    private var riding = false
    fun configure(key: Key, settings: BrakeLightSettings) { lights.getOrPut(key) { Light() }.settings = settings }
    fun forget(accessoryId: String) { lights.keys.removeAll { it.accessoryId == accessoryId } }
    fun sample(speed: Double, engaged: Boolean, at: Long) {
        riding = engaged
        lights.values.forEach { if (engaged) it.preview = null; it.detector.sample(speed, engaged, at, it.settings.sensitivity) }
    }
    fun clear() { riding = false; lights.values.forEach { it.detector.clear() } }
    fun releasePreviews() { lights.values.forEach { it.preview = null } }
    fun preview(key: Key, mode: String?): Boolean {
        if (mode != null && (riding || mode !in MODES)) return false
        val light = lights[key] ?: return false
        light.preview = mode
        return true
    }
    /** @parity /modules/vescape-core/src/index.ts `AccessoryCapability` */
    fun describe(key: Key): Map<String, Any?> = lights.getOrPut(key) { Light() }.let {
        mapOf("brakeLight" to it.settings.toMap(), "lightMode" to it.detector.mode, "lightPreview" to it.preview)
    }
    fun command(key: Key): AccessoryCommand.State = lights.getOrPut(key) { Light() }.let {
        AccessoryCommand.State(key.capabilityId, if(it.detector.mode == null) "unavailable" else "available", it.preview ?: it.detector.mode, it.settings.parked, it.preview != null)
    }
    companion object { val MODES = setOf("riding", "braking", "hard_braking", "not_riding") }
}
