package expo.modules.vescapecore.accessory

import java.io.File
import org.json.JSONObject

/**
 * The shared Accessory Protocol corpus, read straight off the repo tree the way the Refloat schema
 * fixtures are. The same files drive the Swift peer and the ESP32 firmware's native tests, so a
 * contract that drifts on one side fails on all three.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessoryFixtures.swift
 */
internal object AccessoryFixtures {
    private const val DIR = "shared/fixtures/accessory-protocol"

    fun load(name: String): JSONObject {
        val file = File(repoRoot(), "$DIR/$name")
        require(file.isFile) { "missing accessory fixture $name" }
        return JSONObject(file.readText())
    }

    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir")!!).absoluteFile
        while (dir != null && !File(dir, DIR).isDirectory) dir = dir.parentFile
        return requireNotNull(dir) { "$DIR not found above ${System.getProperty("user.dir")}" }
    }

    fun hexToBytes(hex: String): ByteArray {
        require(hex.length % 2 == 0) { "odd-length hex: $hex" }
        return ByteArray(hex.length / 2) {
            ((hex[it * 2].digitToInt(16) shl 4) or hex[it * 2 + 1].digitToInt(16)).toByte()
        }
    }
}
