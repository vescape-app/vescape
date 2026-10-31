package app.vescape.wear

import java.io.File
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Runs the same numerical behavior as TS and Swift, against the actual production controller.
 * @parity /src/modules/map/lib/liveMotion/parity.test.ts
 * @parity /modules/vescape-core/ios/watch/LiveGpsMotionTests.swift
 */
class LiveGpsMotionTest {
    @Test fun `shared fixtures cover correction braking stops recovery reversal jitter gaps and resets`() {
        val fixture = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }
            .map { File(it, "shared/fixtures/live-map-motion.json") }.first { it.exists() }
        val scenarios = JSONObject(fixture.readText()).getJSONArray("scenarios")
        for (i in 0 until scenarios.length()) {
            val scenario = scenarios.getJSONObject(i); val events = scenario.getJSONArray("events")
            val m = LiveGpsMotion(); var source = 1.0
            for (j in 0 until events.length()) {
                val e = events.getJSONObject(j); val at = e.getDouble("now"); val label = "${scenario.getString("name")} at $at"
                when(e.getString("op")) {
                    "reset" -> { source = e.getDouble("source"); m.reset(source, at) }
                    "fix" -> assertEquals(label, e.optBoolean("accepted", true), m.accept(MotionFix(e.getDouble("eastM") / 111320, e.optDouble("northM", 0.0) / 110574,
                        e.optDouble("timestamp", at), e.optDouble("accuracyM", 3.0)), at, e.optDouble("ageMs", 0.0), e.optDouble("source", source)))
                    "speed" -> assertEquals(label, e.optBoolean("accepted", true), m.updateSpeed(e.getDouble("mps"), at, at, e.optDouble("source", source)))
                    "config" -> m.configure(MotionConfig.fromJson(e.toString()), at)
                    "sample" -> {
                        val position = m.position(at)!!
                        if (e.has("eastM")) assertEquals(label, e.getDouble("eastM"), position.first * 111320, 0.0001)
                        if (e.has("northM")) assertEquals(label, e.getDouble("northM"), position.second * 110574, 0.0001)
                        if (e.has("heading")) { if (e.isNull("heading")) assertNull(label, m.pointHeading(at)) else assertEquals(label, e.getDouble("heading"), m.pointHeading(at)!!, 0.0001) }
                        if (e.has("cameraHeading")) { if (e.isNull("cameraHeading")) assertNull(label, m.cameraHeading(at)) else assertEquals(label, e.getDouble("cameraHeading"), m.cameraHeading(at)!!, 0.0001) }
                        if (e.has("cadenceMs")) assertEquals(label, e.getDouble("cadenceMs"), m.cadenceMs, 0.0001)
                        if (e.has("prediction")) assertEquals(label, e.getDouble("prediction"), m.effectivePrediction(at), 0.0001)
                        if (e.has("recovering")) assertEquals(label, e.getBoolean("recovering"), m.recovering)
                    }
                }
            }
        }
    }
}
