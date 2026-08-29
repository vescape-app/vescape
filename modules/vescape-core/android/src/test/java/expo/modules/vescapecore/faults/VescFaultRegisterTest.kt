package expo.modules.vescapecore.faults

import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.buildFaultsTerminalCommand
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val EMPTY_OUTPUT = "No faults registered since startup\n"

private val ONE_FAULT = """

Fault            : FAULT_CODE_ABS_OVER_CURRENT
Motor            : 1
Current          : 121.3
Current filtered : 98.4
Voltage          : 50.21
Duty             : 0.812
RPM              : 7412.0
Tacho            : 91231
Cycles running   : 4123
TIM duty         : 100
TIM val samp     : 50
TIM current samp : 25
TIM top          : 200
Comm step        : 0
Temperature      : 41.20

""".trimIndent()

private val TWO_FAULTS = ONE_FAULT + "\n\nFault            : FAULT_CODE_OVER_TEMP_FET\nMotor            : 1\nTemperature      : 101.00\n"

class VescFaultRegisterFramingTest {
  @Test
  fun `direct framing sends only the fixed literal`() {
    val frame = buildFaultsTerminalCommand(BoardTransport.Direct)
    assertEquals(20, frame[0].toInt() and 0xff)
    assertEquals("faults", String(frame.copyOfRange(1, frame.size), Charsets.US_ASCII))
  }

  @Test
  fun `can framing forwards the same literal to the linked controller`() {
    val frame = buildFaultsTerminalCommand(BoardTransport.Can(42))
    assertEquals(34, frame[0].toInt() and 0xff)
    assertEquals(42, frame[1].toInt() and 0xff)
    assertEquals(20, frame[2].toInt() and 0xff)
    assertEquals("faults", String(frame.copyOfRange(3, frame.size), Charsets.US_ASCII))
  }
}

class VescFaultRegisterParserTest {
  @Test
  fun `explicit no-faults output proves an empty register`() {
    assertEquals(emptyList<VescFaultRegisterEntry>(), VescFaultRegisterParser.parse(EMPTY_OUTPUT))
  }

  @Test
  fun `unrecognised output is not an empty register`() {
    assertNull(VescFaultRegisterParser.parse("Unknown command\n"))
  }

  @Test
  fun `a complete block parses its code, name and every field`() {
    val entries = VescFaultRegisterParser.parse(ONE_FAULT)!!
    assertEquals(1, entries.size)
    val entry = entries[0]
    assertEquals(4, entry.code)
    assertEquals("FAULT_CODE_ABS_OVER_CURRENT", entry.name)
    assertEquals(0, entry.position)
    assertEquals("121.3", entry.fields.first { it.first == "Current" }.second)
    assertEquals("41.20", entry.fields.first { it.first == "Temperature" }.second)
  }

  @Test
  fun `multiple blocks keep controller order`() {
    val entries = VescFaultRegisterParser.parse(TWO_FAULTS)!!
    assertEquals(listOf(0, 1), entries.map { it.position })
    assertEquals(listOf(4, 5), entries.map { it.code })
  }

  @Test
  fun `unknown labels and unknown fault names survive`() {
    val text = "Fault            : FAULT_CODE_FUTURE_THING\nSome New Label   : 7\nfree form line\n"
    val entry = VescFaultRegisterParser.parse(text)!!.single()
    assertNull(entry.code)
    assertEquals("FAULT_CODE_FUTURE_THING", entry.name)
    assertEquals("7", entry.fields.first { it.first == "Some New Label" }.second)
    assertTrue(entry.fields.any { it.second == "free form line" })
    assertTrue(entry.rawBlock.contains("free form line"))
  }
}

class VescFaultRegisterReaderTest {
  @Test
  fun `output settling for a full idle boundary completes the read`() {
    val reader = VescFaultRegisterReader("b", VescFaultRegisterReason.CONNECT, 0)
    reader.onPrintChunk("No faults".toByteArray(), 100)
    reader.onPrintChunk(" registered".toByteArray(), 200)
    assertNull(reader.poll(400))
    val read = reader.poll(700)!!
    assertEquals(VescFaultRegisterStatus.COMPLETE, read.status)
    assertEquals("No faults registered", read.text)
  }

  @Test
  fun `chunk boundaries are reassembled byte for byte`() {
    val reader = VescFaultRegisterReader("b", VescFaultRegisterReason.CONNECT, 0)
    for ((index, part) in ONE_FAULT.chunked(17).withIndex()) {
      reader.onPrintChunk(part.toByteArray(), index * 10L)
    }
    val read = reader.poll(2_000)!!
    assertEquals(ONE_FAULT, read.text)
    assertEquals(VescFaultRegisterStatus.COMPLETE, read.status)
  }

  @Test
  fun `the hard bound never synthesizes completion`() {
    val reader = VescFaultRegisterReader("b", VescFaultRegisterReason.CONNECT, 0)
    var at = 0L
    while (at < VescFaultRegisterReader.HARD_BOUND_MS) {
      at += 100
      reader.onPrintChunk("x".toByteArray(), at)
      if (at < VescFaultRegisterReader.HARD_BOUND_MS) assertNull(reader.poll(at))
    }
    val read = reader.poll(VescFaultRegisterReader.HARD_BOUND_MS)!!
    assertEquals(VescFaultRegisterStatus.INCOMPLETE, read.status)
    assertFalse(read.raw.isEmpty())
  }

  @Test
  fun `a read that never answered is incomplete and empty`() {
    val reader = VescFaultRegisterReader("b", VescFaultRegisterReason.IDLE, 0)
    assertNull(reader.poll(1_000))
    val read = reader.poll(VescFaultRegisterReader.HARD_BOUND_MS)!!
    assertEquals(VescFaultRegisterStatus.INCOMPLETE, read.status)
    assertEquals(0, read.raw.size)
  }

  @Test
  fun `session loss keeps the partial bytes as incomplete evidence`() {
    val reader = VescFaultRegisterReader("b", VescFaultRegisterReason.PREDISCONNECT, 0)
    reader.onPrintChunk("Fault".toByteArray(), 10)
    val read = reader.finishIncomplete()!!
    assertEquals(VescFaultRegisterStatus.INCOMPLETE, read.status)
    assertEquals("Fault", read.text)
    assertTrue(reader.isFinished)
  }
}

class VescFaultAuditPolicyTest {
  @Test
  fun `standing still long enough is one audit opportunity, not one per frame`() {
    val policy = VescFaultAuditPolicy()
    assertNull(policy.observe(0, 0.0))
    assertNull(policy.observe(4_000, 0.0))
    assertEquals(VescFaultRegisterReason.STATIONARY, policy.observe(6_000, 0.0))
    policy.onAuditStarted(6_000)
    assertNull(policy.observe(7_000, 0.0))
    assertNull(policy.observe(200_000, 0.0))
  }

  @Test
  fun `riding again earns the next stop its own audit`() {
    val policy = VescFaultAuditPolicy()
    policy.observe(0, 0.0)
    assertEquals(VescFaultRegisterReason.STATIONARY, policy.observe(6_000, 0.0))
    policy.onAuditStarted(6_000)
    policy.observe(10_000, 24.0)
    assertNull(policy.observe(60_000, 0.0))
    assertEquals(VescFaultRegisterReason.STATIONARY, policy.observe(70_000, 0.0))
  }

  @Test
  fun `moving is never a safe audit opportunity`() {
    val policy = VescFaultAuditPolicy()
    for (at in 0..40) assertNull(policy.observe(at * 1_000L, 18.0))
  }
}

private class FakeSnapshotStore : VescFaultRegisterSnapshotStore {
  val rows = ArrayList<VescFaultRegisterSnapshot>()
  override suspend fun insert(snapshot: VescFaultRegisterSnapshot) { rows.add(snapshot) }
  override suspend fun getForBoard(boardId: String, limit: Int) =
    rows.filter { it.boardId == boardId }.reversed().take(limit)
  override suspend fun get(id: String) = rows.firstOrNull { it.id == id }
  override suspend fun latestComplete(boardId: String) = rows.lastOrNull {
    it.boardId == boardId && it.status == VescFaultRegisterStatus.COMPLETE
  }
  override suspend fun hasBaseline(boardId: String) =
    rows.any { it.boardId == boardId && it.reason == VescFaultRegisterReason.BASELINE }
}

private class FakeFaultStore : VescFaultStore {
  val rows = LinkedHashMap<String, VescFaultOccurrence>()
  override suspend fun getForBoard(boardId: String) = rows.values.filter { it.boardId == boardId }
  override suspend fun getAll() = rows.values.toList()
  override suspend fun openLive(boardId: String) = rows.values.lastOrNull {
    it.boardId == boardId && it.source == VescFaultSource.LIVE && it.clearedAtMs == null
  }
  override suspend fun upsert(occurrence: VescFaultOccurrence) { rows[occurrence.id] = occurrence }
  override suspend fun setDismissed(id: String, dismissed: Boolean): Boolean {
    val row = rows[id] ?: return false
    rows[id] = row.copy(dismissed = dismissed)
    return true
  }
}

class VescFaultRegisterCoordinatorTest {
  private val snapshots = FakeSnapshotStore()
  private val faultStore = FakeFaultStore()
  private var clock = 1_000L
  private var ids = 0
  private val faults = VescFaultCoordinator(faultStore, now = { clock }, newId = { "f${ids++}" })
  private val coordinator = VescFaultRegisterCoordinator(
    snapshots,
    faults,
    now = { clock },
    newId = { "s${ids++}" },
  )

  private fun read(
    text: String,
    reason: VescFaultRegisterReason = VescFaultRegisterReason.CONNECT,
    status: VescFaultRegisterStatus = VescFaultRegisterStatus.COMPLETE,
  ) = VescFaultRegisterRead(reason, status, text.toByteArray(), text)

  @Test
  fun `a first read is the Board's baseline and its entries are discarded evidence`() = runBlocking {
    assertEquals(VescFaultRegisterReason.BASELINE, coordinator.connectReason("board"))
    val record = coordinator.record("board", read(TWO_FAULTS, VescFaultRegisterReason.BASELINE))
    assertEquals(2, record.baselineCount)
    val occurrences = faultStore.getForBoard("board")
    assertEquals(2, occurrences.size)
    assertTrue(occurrences.all { it.source == VescFaultSource.BASELINE })
    assertTrue(occurrences.all { it.dismissed })
    assertTrue(occurrences.all { it.occurredAtMs == null })
    assertEquals(listOf(0, 1), occurrences.map { it.registerPosition })
    assertEquals(VescFaultRegisterReason.CONNECT, coordinator.connectReason("board"))
  }

  @Test
  fun `re-linking replaces the comparison baseline`() = runBlocking {
    coordinator.record("board", read(ONE_FAULT, VescFaultRegisterReason.BASELINE))
    coordinator.requestBaseline("board")
    assertEquals(VescFaultRegisterReason.BASELINE, coordinator.connectReason("board"))
  }

  @Test
  fun `unchanged evidence never duplicates`() = runBlocking {
    coordinator.record("board", read(TWO_FAULTS, VescFaultRegisterReason.BASELINE))
    val again = coordinator.record("board", read(TWO_FAULTS, VescFaultRegisterReason.STATIONARY))
    assertTrue(again.unchanged)
    assertEquals(0, again.createdCount)
    assertEquals(1, snapshots.rows.size)
    assertEquals(2, faultStore.getForBoard("board").size)
  }

  @Test
  fun `a newly appended entry becomes a register-discovered occurrence`() = runBlocking {
    coordinator.record("board", read(ONE_FAULT, VescFaultRegisterReason.BASELINE))
    clock = 5_000
    val record = coordinator.record("board", read(TWO_FAULTS, VescFaultRegisterReason.STATIONARY))
    assertEquals(1, record.createdCount)
    val discovered = faultStore.getForBoard("board").last()
    assertEquals(VescFaultSource.REGISTER, discovered.source)
    assertNull(discovered.occurredAtMs)
    assertEquals(5_000L, discovered.discoveredAtMs)
    assertEquals(1, discovered.registerPosition)
    assertFalse(discovered.dismissed)
  }

  @Test
  fun `one unseen entry from a live read enriches the open occurrence`() = runBlocking {
    coordinator.record("board", read(ONE_FAULT, VescFaultRegisterReason.BASELINE))
    faults.onActiveFault("board", 8)
    val open = faultStore.openLive("board")!!
    val record = coordinator.record("board", read(TWO_FAULTS, VescFaultRegisterReason.LIVE))
    assertEquals(open.id, record.enrichedOccurrenceId)
    // No extra occurrence: the entry became context on the activation Vescape already had.
    assertEquals(2, faultStore.getAll().size)
    assertEquals(1, faultStore.rows[open.id]!!.registerPosition)
    assertNotNull(faultStore.rows[open.id]!!.registerSnapshotId)
  }

  @Test
  fun `two unseen entries stay separate rather than guessing which one matched`() = runBlocking {
    coordinator.record("board", read(EMPTY_OUTPUT, VescFaultRegisterReason.BASELINE))
    faults.onActiveFault("board", 8)
    val record = coordinator.record("board", read(TWO_FAULTS, VescFaultRegisterReason.LIVE))
    assertNull(record.enrichedOccurrenceId)
    assertEquals(2, record.createdCount)
    assertEquals(2, faultStore.getAll().count { it.source == VescFaultSource.REGISTER })
  }

  @Test
  fun `incomplete output is retained but proves nothing`() = runBlocking {
    val record = coordinator.record(
      "board",
      read("Fault            : FAULT_CODE_DRV\n", VescFaultRegisterReason.LIVE, VescFaultRegisterStatus.INCOMPLETE),
    )
    assertEquals(0, record.createdCount)
    assertNotNull(record.snapshot)
    assertNull(record.snapshot!!.entries)
    assertEquals(0, faultStore.getAll().size)
    // And it is not the comparison baseline: the next complete read still diffs against nothing.
    assertNull(snapshots.latestComplete("board"))
  }

  @Test
  fun `a read that never answered is not stored at all`() = runBlocking {
    val record = coordinator.record(
      "board",
      VescFaultRegisterRead(VescFaultRegisterReason.IDLE, VescFaultRegisterStatus.INCOMPLETE, ByteArray(0), ""),
    )
    assertNull(record.snapshot)
    assertEquals(0, snapshots.rows.size)
  }

  @Test
  fun `unparseable complete output keeps its bytes`() = runBlocking {
    val record = coordinator.record("board", read("garbage from a future firmware"))
    assertNull(record.snapshot!!.entries)
    assertEquals("garbage from a future firmware", record.snapshot!!.text)
    assertEquals(0, faultStore.getAll().size)
  }

  @Test
  fun `an empty complete register creates nothing`() = runBlocking {
    val record = coordinator.record("board", read(EMPTY_OUTPUT, VescFaultRegisterReason.BASELINE))
    assertEquals(0, record.baselineCount)
    assertEquals(emptyList<VescFaultRegisterEntry>(), record.snapshot!!.entries)
    assertEquals(0, faultStore.getAll().size)
  }

  @Test
  fun `the collection kill switch stops every register write`() = runBlocking {
    faults.collectionEnabled = false
    val record = coordinator.record("board", read(TWO_FAULTS, VescFaultRegisterReason.BASELINE))
    assertNull(record.snapshot)
    assertEquals(0, snapshots.rows.size)
    assertEquals(0, faultStore.getAll().size)
  }
}
