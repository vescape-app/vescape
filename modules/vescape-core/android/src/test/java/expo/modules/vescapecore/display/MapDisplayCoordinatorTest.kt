package expo.modules.vescapecore.display

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** @parity /modules/vescape-core/ios/watch/MapDisplayCoordinatorTests.swift */
class MapDisplayCoordinatorTest {
    private fun decode(value: Any?): Any? = when (value) {
        JSONObject.NULL -> null
        is JSONObject -> value.keys().asSequence().associateWith { decode(value.get(it)) }
        is JSONArray -> (0 until value.length()).map { decode(value.get(it)) }
        else -> value
    }

    @Test fun `shared fixtures cover idle work raw quality source clocks overlays and teardown`() {
        val file = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }
            .map { File(it, "shared/fixtures/map-display-coordinator.json") }.first { it.exists() }
        val scenarios = JSONObject(file.readText()).getJSONArray("scenarios")
        for (index in 0 until scenarios.length()) {
            val scenario = scenarios.getJSONObject(index)
            var local = 0.0
            var emissions = 0
            data class Task(val at: Double, val action: () -> Unit)
            val tasks = mutableListOf<Task>()
            val owner = MapDisplayCoordinator({ local }, { delay, action ->
                val task = Task(local + delay, action)
                tasks.add(task)
                ({ tasks.remove(task); Unit })
            }, { emissions++ })
            val events = scenario.getJSONArray("events")
            for (eventIndex in 0 until events.length()) {
                val event = events.getJSONObject(eventIndex)
                val label = "${scenario.getString("name")} event $eventIndex"
                @Suppress("UNCHECKED_CAST")
                val body = event.optJSONObject("body")?.let { decode(it) as Map<String, Any?> } ?: emptyMap()
                when (event.getString("op")) {
                    "options" -> owner.options(body)
                    "input" -> owner.input(event.getString("name"), body)
                    "advance" -> {
                        val until = event.getDouble("now")
                        var count = 0
                        while (true) {
                            val task = tasks.filter { it.at <= until }.minByOrNull { it.at } ?: break
                            assertTrue("$label runaway timer", count++ < 1000)
                            tasks.remove(task)
                            local = task.at
                            task.action()
                        }
                        local = until
                    }
                    "check" -> {
                        val snapshot = owner.snapshot()
                        val expected = event.getJSONObject("expect")
                        for (key in expected.keys()) {
                            val actual: Any? = when (key) {
                                "emissions" -> emissions
                                "pending" -> tasks.size
                                "segmentsCount" -> (snapshot["segments"] as List<*>).size
                                "trailCount", "minTrail" -> (snapshot["trail"] as List<*>).size
                                else -> key.split('.').fold(snapshot as Any?) { parent, part -> (parent as? Map<*, *>)?.get(part) }
                            }
                            val wanted = decode(expected.get(key))
                            if (key == "minTrail") assertTrue("$label $key", (actual as Number).toInt() >= (wanted as Number).toInt())
                            else if (actual is Number && wanted is Number) assertEquals("$label $key", wanted.toDouble(), actual.toDouble(), 0.0001)
                            else assertEquals("$label $key", wanted, actual)
                        }
                    }
                    else -> fail("$label unknown operation")
                }
            }
            owner.stop()
            assertTrue(tasks.isEmpty())
        }
    }
}
