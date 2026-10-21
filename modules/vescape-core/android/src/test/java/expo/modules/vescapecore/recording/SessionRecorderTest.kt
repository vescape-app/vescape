package expo.modules.vescapecore.recording

import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.service.SessionConfig
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.io.IOException
import java.io.Writer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class SessionRecorderTest {

    @Test
    fun firstWriteFailureStopsAllLaterWrites() {
        val writer = object : Writer() {
            var attempts = 0
            override fun write(buffer: CharArray, offset: Int, count: Int) {
                attempts += 1
                throw IOException("injected")
            }
            override fun flush() = Unit
            override fun close() = Unit
        }
        val file = File.createTempFile("session-recorder-failure", ".jsonl").also { it.deleteOnExit() }
        val recorder = SessionRecorder(session, file, writer) {}

        recorder.start()
        recorder.recordState("later")
        recorder.recordState("still-later")

        assertEquals(1, writer.attempts)
    }

    private val session = SessionConfig(
        appBoardId = "board-1",
        deviceId = "AA:BB",
        deviceName = "Test Board",
        transport = BoardTransport.Can(10),
        pollIntervalMs = 100L,
        recordingEnabled = true,
        telemetryRecordingEnabled = false,
    )

    /**
     * BLE chunks are written on the GATT callback thread while phone heading arrives from JS on
     * the module thread — unserialized writes concatenated two objects onto one line and broke
     * replay of the whole recording.
     */
    @Test
    fun concurrentWritesProduceOnlyWellFormedLines() {
        val file = File.createTempFile("session-recorder-test", ".jsonl").also { it.deleteOnExit() }
        val recorder = SessionRecorder(session, file)
        recorder.start()

        val threads = 8
        val perThread = 200
        val start = CountDownLatch(1)
        val done = CountDownLatch(threads)
        repeat(threads) { index ->
            Thread {
                start.await()
                repeat(perThread) { i ->
                    if (index % 2 == 0) {
                        recorder.recordState("probe-${index * 1000 + i}")
                    } else {
                        recorder.recordState("tick", mapOf("thread" to index, "i" to i))
                    }
                }
                done.countDown()
            }.start()
        }
        start.countDown()
        assertEquals(true, done.await(30, TimeUnit.SECONDS))
        recorder.finish("stopped")

        val lines = file.readLines().filter { it.isNotBlank() }
        // meta + recording-started + all writes + stopped
        assertEquals(3 + threads * perThread, lines.size)
        lines.forEach { line ->
            assertEquals(false, line.contains("}{"))
            val json = JSONObject(line) // throws on a truncated line
            assertEquals(true, json.has("kind"))
        }
    }
}
