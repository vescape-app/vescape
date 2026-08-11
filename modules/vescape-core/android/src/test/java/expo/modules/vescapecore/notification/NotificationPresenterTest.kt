package expo.modules.vescapecore.notification
import expo.modules.vescapecore.connection.BoardPhase
import expo.modules.vescapecore.protocol.RefloatTelemetry
import expo.modules.vescapecore.connection.displayText
import java.util.Locale
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Before
import org.junit.Test

class NotificationPresenterTest {

    private lateinit var originalLocale: Locale

    @Before
    fun setUp() {
        originalLocale = Locale.getDefault()
        Locale.setDefault(Locale.US)
    }

    @After
    fun tearDown() {
        Locale.setDefault(originalLocale)
    }

    @Test
    fun `formatTelemetryText with battery percent`() {
        val text = NotificationFormatter.formatTelemetryText(
            telemetry(batteryVoltage = 75.13),
            batteryPercent = 45.0,
        )
        assertEquals("45% (75.1V)", text)
    }

    @Test
    fun `formatTelemetryText without battery percent falls back to voltage`() {
        val text = NotificationFormatter.formatTelemetryText(
            telemetry(batteryVoltage = 75.13),
            batteryPercent = null,
        )
        assertEquals("75.1V", text)
    }

    @Test
    fun `formatTelemetryText ignores speed and duty cycle`() {
        val text = NotificationFormatter.formatTelemetryText(
            telemetry(speed = -12.7, dutyCycle = 0.42, batteryVoltage = 50.0),
            batteryPercent = null,
        )
        assertEquals("50.0V", text)
    }

    @Test
    fun `displayText idle`() {
        assertEquals("Board not connected", BoardPhase.Idle.displayText())
    }

    @Test
    fun `displayText connecting`() {
        assertEquals("Connecting…", BoardPhase.Connecting.displayText())
    }

    @Test
    fun `displayText rescanning`() {
        assertEquals("Searching…", BoardPhase.Rescanning.displayText())
    }

    @Test
    fun `shortCriticalText connected with battery percent`() {
        assertEquals(
            "45%",
            NotificationFormatter.formatShortCriticalText(BoardPhase.Connected, telemetry(), 45.0),
        )
    }

    @Test
    fun `shortCriticalText connected without battery percent`() {
        assertEquals(
            "75.1V",
            NotificationFormatter.formatShortCriticalText(
                BoardPhase.Connected, telemetry(batteryVoltage = 75.13), null,
            ),
        )
    }

    @Test
    fun `shortCriticalText stale`() {
        assertEquals("⚠", NotificationFormatter.formatShortCriticalText(BoardPhase.Stale, null, null))
    }

    @Test
    fun `shortCriticalText error`() {
        assertEquals("✕", NotificationFormatter.formatShortCriticalText(BoardPhase.Error, null, null))
    }

    @Test
    fun `shortCriticalText connecting`() {
        assertEquals("…", NotificationFormatter.formatShortCriticalText(BoardPhase.Connecting, null, null))
    }

    @Test
    fun `shortCriticalText idle`() {
        assertEquals("—", NotificationFormatter.formatShortCriticalText(BoardPhase.Idle, null, null))
    }

    @Test
    fun `idle presentation ignores cached telemetry and battery percent`() {
        val presentation = NotificationPresentation.resolve(
            phase = BoardPhase.Idle,
            telemetry = telemetry(batteryVoltage = 75.13),
            batteryPercent = 45.0,
        )

        assertEquals("Board not connected", presentation.text)
        assertEquals("—", presentation.shortCriticalText)
        assertEquals(null, presentation.batteryProgressPercent)
        assertEquals(false, presentation.canDisconnect)
    }

    @Test
    fun `stale presentation ignores cached battery progress and keeps disconnect`() {
        val presentation = NotificationPresentation.resolve(
            phase = BoardPhase.Stale,
            telemetry = telemetry(batteryVoltage = 75.13),
            batteryPercent = 45.0,
        )

        assertEquals("Telemetry stale", presentation.text)
        assertEquals("⚠", presentation.shortCriticalText)
        assertEquals(null, presentation.batteryProgressPercent)
        assertEquals(true, presentation.canDisconnect)
    }

    @Test
    fun `reconnecting presentation shows the live phase, not idle`() {
        val presentation = NotificationPresentation.resolve(
            phase = BoardPhase.Reconnecting,
            telemetry = telemetry(batteryVoltage = 75.13),
            batteryPercent = 45.0,
        )

        assertEquals("Reconnecting…", presentation.text)
        assertEquals("…", presentation.shortCriticalText)
        assertEquals(null, presentation.batteryProgressPercent)
        assertEquals(true, presentation.canDisconnect)
    }

    /**
     * Whole-phase contract in one table: a new [BoardPhase] fails here until its notification
     * rendering is decided, and flipping an existing phase's text or Disconnect availability shows
     * up as an explicit diff instead of riding along with an unrelated change.
     */
    @Test
    fun `every phase renders its own text and a session-ownership disconnect`() {
        val expected = mapOf(
            BoardPhase.Idle to ("Board not connected" to false),
            BoardPhase.Connecting to ("Connecting…" to true),
            BoardPhase.Discovering to ("Discovering…" to true),
            BoardPhase.Subscribing to ("Subscribing…" to true),
            BoardPhase.WaitingForTelemetry to ("Waiting for telemetry…" to true),
            BoardPhase.Connected to ("Connected" to true),
            BoardPhase.Stale to ("Telemetry stale" to true),
            BoardPhase.Reconnecting to ("Reconnecting…" to true),
            BoardPhase.Rescanning to ("Searching…" to true),
            BoardPhase.Disconnecting to ("Disconnecting…" to false),
            BoardPhase.Error to ("Connection error" to true),
        )

        assertEquals(BoardPhase.entries.toSet(), expected.keys)
        for ((phase, contract) in expected) {
            val (text, canDisconnect) = contract
            val presentation = NotificationPresentation.resolve(phase = phase)
            assertEquals("text for $phase", text, presentation.text)
            assertEquals("canDisconnect for $phase", canDisconnect, presentation.canDisconnect)
        }
    }

    /** Only Idle may say "not connected" — every other phase must not impersonate an idle service. */
    @Test
    fun `no phase borrows the idle text`() {
        for (phase in BoardPhase.entries - BoardPhase.Idle) {
            val presentation = NotificationPresentation.resolve(phase = phase)
            assertNotEquals("text for $phase", BoardPhase.Idle.displayText(), presentation.text)
        }
    }

    /** Telemetry numbers belong to a live link only, so a dead link can never show stale values. */
    @Test
    fun `only connected renders telemetry values`() {
        for (phase in BoardPhase.entries - BoardPhase.Connected) {
            val presentation = NotificationPresentation.resolve(
                phase = phase,
                telemetry = telemetry(batteryVoltage = 75.13),
                batteryPercent = 45.0,
            )
            assertEquals("battery progress for $phase", null, presentation.batteryProgressPercent)
            assertEquals("text for $phase", phase.displayText(), presentation.text)
        }
    }

    @Test
    fun `connected presentation shows battery progress`() {
        val presentation = NotificationPresentation.resolve(
            phase = BoardPhase.Connected,
            telemetry = telemetry(batteryVoltage = 75.13),
            batteryPercent = 45.0,
        )

        assertEquals("45% (75.1V)", presentation.text)
        assertEquals("45%", presentation.shortCriticalText)
        assertEquals(45, presentation.batteryProgressPercent)
        assertEquals(true, presentation.canDisconnect)
    }

    private fun telemetry(
        speed: Double = 0.0,
        dutyCycle: Double = 0.0,
        batteryVoltage: Double = 0.0,
    ): RefloatTelemetry = RefloatTelemetry(
        hasFault = false,
        faultCode = 0,
        pitch = 0.0,
        roll = 0.0,
        balancePitch = 0.0,
        balanceCurrent = 0.0,
        speed = speed,
        batteryVoltage = batteryVoltage,
        motorCurrent = 0.0,
        batteryCurrent = 0.0,
        erpm = 0,
        dutyCycle = dutyCycle,
        state = 0,
        switchState = 0,
        adc1 = 0.0,
        adc2 = 0.0,
        odometer = null,
        tempMosfet = null,
        tempMotor = null,
        avgLatency = null,
        pullRateHz = null,
        lastPacketAt = 0L,
        location = null,
    )
}
